import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

// ── Token refresh ───────────────────────────────────────────────────
async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);

  if (expiresAt.getTime() - now.getTime() > 120_000) {
    return currentAccessToken;
  }

  console.log("[sync-xpm] Token expired, refreshing...");
  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const currentRefreshToken = await decryptToken(connection.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const encryptedAccessToken = await encryptToken(tokens.access_token);
  const encryptedRefreshToken = await encryptToken(tokens.refresh_token);

  await supabase
    .from("xero_connections")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

// ── XPM API helpers ─────────────────────────────────────────────────
function xpmHeaders(accessToken: string, xeroTenantId: string, lastSyncedAt?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroTenantId,
    Accept: "application/json",
  };
  if (lastSyncedAt) h["If-Modified-Since"] = lastSyncedAt;
  return h;
}

async function xpmGet(path: string, accessToken: string, xeroTenantId: string, lastSyncedAt?: string): Promise<any> {
  const url = `${XPM_BASE}${path}`;
  console.log(`[sync-xpm] GET ${url}`);
  const res = await fetch(url, { headers: xpmHeaders(accessToken, xeroTenantId, lastSyncedAt) });

  if (res.status === 304) return null; // Not modified
  if (res.status === 403 || res.status === 401) {
    console.warn(`[sync-xpm] ${res.status} on ${path}`);
    return null;
  }
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[sync-xpm] ${res.status} on ${path}: ${errText}`);
    return null;
  }
  return res.json();
}

// ── Entity type mapping from XPM Type/Structure fields ──────────────
const XPM_TYPE_MAP: Record<string, string> = {
  Company: "Company",
  Individual: "Individual",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  Trust: "Trust",
  SuperFund: "smsf",
  "Super Fund": "smsf",
  SMSF: "smsf",
};

const XPM_STRUCTURE_MAP: Record<string, string> = {
  "Trustee Company": "Company",
  "Discretionary Trust": "trust_discretionary",
  "Unit Trust": "trust_unit",
  "Hybrid Trust": "trust_hybrid",
  "Bare Trust": "trust_bare",
  "Testamentary Trust": "trust_testamentary",
  "Deceased Estate": "trust_deceased_estate",
  "Family Trust": "trust_family",
  "Self Managed Superannuation Fund": "smsf",
  SMSF: "smsf",
};

function resolveEntityType(type?: string, structure?: string, businessStructure?: string): string {
  // Structure field is more specific, prefer it
  if (structure) {
    const mapped = XPM_STRUCTURE_MAP[structure];
    if (mapped) return mapped;
  }
  if (businessStructure) {
    const mapped = XPM_STRUCTURE_MAP[businessStructure];
    if (mapped) return mapped;
  }
  if (type) {
    const mapped = XPM_TYPE_MAP[type];
    if (mapped) return mapped;
  }
  return "Unclassified";
}

// ── Relationship type mapping ───────────────────────────────────────
const REL_TYPE_MAP: Record<string, string> = {
  "director of": "director",
  "trustee of": "trustee",
  "shareholder of": "shareholder",
  "beneficiary of": "beneficiary",
  "partner of": "partner",
  "appointer of": "appointer",
  "appointor of": "appointer",
  "settlor of": "settlor",
  "member of": "member",
  "spouse of": "spouse",
  "parent of": "parent",
  "child of": "child",
};

// ── Detect corporate trustee from name ──────────────────────────────
function isCorporateTrustee(name: string, entityType: string): boolean {
  if (entityType !== "Company") return false;
  const lower = name.toLowerCase();
  return lower.includes("as trustee for") || lower.includes("atf ") || lower.includes(" atf") || /\btrustee\b/.test(lower);
}

function extractTrustName(name: string): string | null {
  const atfMatch = name.match(/(?:as\s+trustee\s+for|atf)\s+(.+)/i);
  return atfMatch ? atfMatch[1].trim() : null;
}

// ── Main ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Xero connection
    const { data: connections } = await supabase
      .from("xero_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("connected_at", { ascending: false })
      .limit(1);

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ error: "No Xero connection found. Please connect to Xero first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connections[0];
    const accessToken = await refreshAccessToken(supabase, connection);

    // Discover the PRACTICEMANAGER tenant ID from Xero /connections
    let xeroTenantId = connection.xero_tenant_id;
    try {
      const connectionsRes = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (connectionsRes.ok) {
        const conns = await connectionsRes.json();
        const pmConn = conns.find((c: any) => c.tenantType === "PRACTICEMANAGER");
        if (pmConn) {
          console.log(`[sync-xpm] Using PRACTICEMANAGER tenant: ${pmConn.tenantName} (${pmConn.tenantId})`);
          xeroTenantId = pmConn.tenantId;
        } else {
          console.log("[sync-xpm] No PRACTICEMANAGER connection found, using stored tenant ID");
        }
      }
    } catch (e) {
      console.warn("[sync-xpm] Failed to fetch /connections, using stored tenant ID:", e);
    }

    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not set on connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // accessToken already obtained above

    // Check last sync timestamp for If-Modified-Since
    const { data: lastImport } = await supabase
      .from("import_logs")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .like("file_name", "xpm-sync%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastSyncedAt = lastImport?.created_at || undefined;

    const warnings: string[] = [];
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let relationshipsCreated = 0;
    let relationshipsSkipped = 0;
    let groupsCreated = 0;
    let staffFetched = 0;
    let trusteesDetected = 0;
    const typeCounts: Record<string, number> = {};
    const xeroUuidToEntityId = new Map<string, string>();
    const trusteePairs: { trusteeEntityId: string; trustName: string }[] = [];

    // ════════════════════════════════════════════════════════════════
    // STEP 1: Fetch /client/list — all clients
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 1: Fetching client list...");
    const clientListData = await xpmGet("/client/list", accessToken, xeroTenantId, lastSyncedAt);

    if (!clientListData) {
      return new Response(JSON.stringify({
        success: true,
        message: "No changes since last sync",
        entitiesCreated: 0,
        entitiesUpdated: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse client list - XPM 3.1 returns ClientList > Client array
    const rawClients = clientListData?.ClientList?.Client
      || clientListData?.Clients
      || clientListData?.ClientList
      || [];
    const clients = Array.isArray(rawClients) ? rawClients : [rawClients].filter(Boolean);
    console.log(`[sync-xpm] Found ${clients.length} clients`);

    // ════════════════════════════════════════════════════════════════
    // STEP 2: Fetch /client/{uuid} — detail for each client
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 2: Fetching client details...");

    interface ClientDetail {
      uuid: string;
      name: string;
      type: string;
      structure: string;
      businessStructure: string;
      companyNumber: string | null; // ACN
      taxNumber: string | null; // ABN
      relationshipCount: number;
    }

    const clientDetails: ClientDetail[] = [];

    for (const client of clients) {
      const uuid = client.UUID || client.ClientUUID || client.ID;
      if (!uuid) continue;

      const detail = await xpmGet(`/client/${uuid}`, accessToken, xeroTenantId);
      const c = detail?.Client || detail || client;

      clientDetails.push({
        uuid,
        name: c.Name || `${c.FirstName || ""} ${c.LastName || ""}`.trim(),
        type: c.Type || client.Type || "",
        structure: c.Structure || client.Structure || "",
        businessStructure: c.BusinessStructure || client.BusinessStructure || "",
        companyNumber: c.CompanyNumber || c.ACN || null,
        taxNumber: c.TaxNumber || c.ABN || null,
        relationshipCount: parseInt(c.RelationshipCount || "0", 10),
      });
    }

    // Upsert entities from client details
    for (const cd of clientDetails) {
      if (!cd.name) continue;

      const entityType = resolveEntityType(cd.type, cd.structure, cd.businessStructure);
      const isTrustee = isCorporateTrustee(cd.name, entityType);

      typeCounts[entityType] = (typeCounts[entityType] || 0) + 1;
      if (isTrustee) trusteesDetected++;

      // Try find by xpm_uuid first, then by name
      let existing: { id: string; entity_type: string; xpm_uuid: string | null; abn: string | null; acn: string | null; is_trustee_company: boolean } | null = null;

      const { data: byUuid } = await supabase
        .from("entities")
        .select("id, entity_type, xpm_uuid, abn, acn, is_trustee_company")
        .eq("tenant_id", tenantId)
        .eq("xpm_uuid", cd.uuid)
        .is("deleted_at", null)
        .maybeSingle();
      existing = byUuid;

      if (!existing) {
        const { data: byName } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid, abn, acn, is_trustee_company")
          .eq("tenant_id", tenantId)
          .eq("name", cd.name)
          .is("deleted_at", null)
          .maybeSingle();
        existing = byName;
      }

      if (existing) {
        const updates: Record<string, any> = {};
        if (entityType !== "Unclassified" && existing.entity_type === "Unclassified") updates.entity_type = entityType;
        if (!existing.xpm_uuid) updates.xpm_uuid = cd.uuid;
        if (cd.taxNumber && !existing.abn) updates.abn = cd.taxNumber;
        if (cd.companyNumber && !existing.acn) updates.acn = cd.companyNumber;
        if (isTrustee && !existing.is_trustee_company) updates.is_trustee_company = true;
        if (Object.keys(updates).length > 0) {
          updates.source = "imported";
          await supabase.from("entities").update(updates).eq("id", existing.id);
          entitiesUpdated++;
        }
        xeroUuidToEntityId.set(cd.uuid, existing.id);
      } else {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            tenant_id: tenantId,
            name: cd.name,
            xpm_uuid: cd.uuid,
            entity_type: entityType,
            abn: cd.taxNumber,
            acn: cd.companyNumber,
            is_trustee_company: isTrustee,
            source: "imported",
          })
          .select("id")
          .single();

        if (error) {
          warnings.push(`Failed to create entity "${cd.name}": ${error.message}`);
          continue;
        }
        xeroUuidToEntityId.set(cd.uuid, data.id);
        entitiesCreated++;
      }

      // Track trustee→trust pairings
      if (isTrustee) {
        const trustName = extractTrustName(cd.name);
        if (trustName) {
          trusteePairs.push({ trusteeEntityId: xeroUuidToEntityId.get(cd.uuid)!, trustName });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // STEP 3: Fetch /client/{uuid}/contacts — relationships
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 3: Fetching client relationships...");

    const relDedupeSet = new Set<string>();

    for (const cd of clientDetails) {
      if (cd.relationshipCount === 0) continue;

      const contactsData = await xpmGet(`/client/${cd.uuid}/contacts`, accessToken, xeroTenantId);
      if (!contactsData) continue;

      const rawContacts = contactsData?.ContactList?.Contact
        || contactsData?.Contacts
        || contactsData?.ContactList
        || [];
      const contactList = Array.isArray(rawContacts) ? rawContacts : [rawContacts].filter(Boolean);

      for (const contact of contactList) {
        const relTypeRaw = (contact.RelationshipType || contact.Type || "").trim().toLowerCase();
        const relatedUuid = contact.RelatedClientUUID || contact.RelatedClient?.UUID || contact.UUID;
        const relatedName = contact.RelatedClientName || contact.RelatedClient?.Name || contact.Name;

        if (!relTypeRaw || !relatedUuid) continue;

        const relType = REL_TYPE_MAP[relTypeRaw];
        if (!relType) {
          warnings.push(`Unknown relationship type "${contact.RelationshipType}" on client ${cd.name}`);
          relationshipsSkipped++;
          continue;
        }

        // Ensure the related entity exists
        let relatedEntityId = xeroUuidToEntityId.get(relatedUuid);
        if (!relatedEntityId && relatedName) {
          // Create/find the related entity
          const { data: existingRel } = await supabase
            .from("entities")
            .select("id")
            .eq("tenant_id", tenantId)
            .or(`xpm_uuid.eq.${relatedUuid},name.eq.${relatedName}`)
            .is("deleted_at", null)
            .maybeSingle();

          if (existingRel) {
            relatedEntityId = existingRel.id;
            xeroUuidToEntityId.set(relatedUuid, existingRel.id);
          } else {
            const { data: newEnt, error: newErr } = await supabase
              .from("entities")
              .insert({
                tenant_id: tenantId,
                name: relatedName,
                xpm_uuid: relatedUuid,
                entity_type: "Unclassified",
                source: "imported",
              })
              .select("id")
              .single();

            if (newErr) {
              warnings.push(`Failed to create related entity "${relatedName}": ${newErr.message}`);
              relationshipsSkipped++;
              continue;
            }
            relatedEntityId = newEnt.id;
            xeroUuidToEntityId.set(relatedUuid, newEnt.id);
            entitiesCreated++;
          }
        }

        if (!relatedEntityId) {
          relationshipsSkipped++;
          continue;
        }

        const fromEntityId = xeroUuidToEntityId.get(cd.uuid);
        if (!fromEntityId) {
          relationshipsSkipped++;
          continue;
        }

        // Direction: "Director Of" means cd.uuid IS a director OF relatedUuid
        // So from=cd.uuid (person/company), to=relatedUuid (company/trust)
        let fromId = fromEntityId;
        let toId = relatedEntityId;

        // Symmetric relationships: normalize by sorting IDs
        if (relType === "spouse" || relType === "partner") {
          if (fromId > toId) [fromId, toId] = [toId, fromId];
        }

        const dedupeKey = `${relType}:${fromId}:${toId}`;
        if (relDedupeSet.has(dedupeKey)) continue;
        relDedupeSet.add(dedupeKey);

        // Check existing
        const { data: existingRelRow } = await supabase
          .from("relationships")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("from_entity_id", fromId)
          .eq("to_entity_id", toId)
          .eq("relationship_type", relType)
          .is("deleted_at", null)
          .maybeSingle();

        if (existingRelRow) continue;

        const { error: relErr } = await supabase
          .from("relationships")
          .insert({
            tenant_id: tenantId,
            from_entity_id: fromId,
            to_entity_id: toId,
            relationship_type: relType,
            source: "imported",
            confidence: "imported",
          });

        if (relErr) {
          warnings.push(`Failed to create ${relType} relationship: ${cd.name} → ${relatedName}: ${relErr.message}`);
          relationshipsSkipped++;
        } else {
          relationshipsCreated++;
        }
      }
    }

    // Auto-create trustee relationships from naming patterns
    for (const pair of trusteePairs) {
      const { data: trustEntity } = await supabase
        .from("entities")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", `%${pair.trustName}%`)
        .is("deleted_at", null)
        .maybeSingle();

      if (trustEntity) {
        const dedupeKey = `trustee:${pair.trusteeEntityId}:${trustEntity.id}`;
        if (!relDedupeSet.has(dedupeKey)) {
          relDedupeSet.add(dedupeKey);
          const { data: existingRel } = await supabase
            .from("relationships")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("from_entity_id", pair.trusteeEntityId)
            .eq("to_entity_id", trustEntity.id)
            .eq("relationship_type", "trustee")
            .is("deleted_at", null)
            .maybeSingle();

          if (!existingRel) {
            const { error: relErr } = await supabase
              .from("relationships")
              .insert({
                tenant_id: tenantId,
                from_entity_id: pair.trusteeEntityId,
                to_entity_id: trustEntity.id,
                relationship_type: "trustee",
                source: "imported",
                confidence: "imported",
              });
            if (!relErr) relationshipsCreated++;
            else warnings.push(`Failed to create trustee rel for "${pair.trustName}": ${relErr.message}`);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // STEP 4: Fetch /clientgroup/list — corporate groups
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 4: Fetching client groups...");

    const groupData = await xpmGet("/clientgroup/list", accessToken, xeroTenantId);
    const rawGroups = groupData?.ClientGroupList?.ClientGroup
      || groupData?.ClientGroups
      || groupData?.ClientGroupList
      || [];
    const groups = Array.isArray(rawGroups) ? rawGroups : [rawGroups].filter(Boolean);
    console.log(`[sync-xpm] Found ${groups.length} client groups`);

    for (const group of groups) {
      const groupName = group.Name;
      if (!groupName) continue;

      // Create or find structure for this group
      const { data: existingStruct } = await supabase
        .from("structures")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", groupName)
        .is("deleted_at", null)
        .maybeSingle();

      let structureId: string;
      if (existingStruct) {
        structureId = existingStruct.id;
      } else {
        const { data: newStruct, error: structErr } = await supabase
          .from("structures")
          .insert({ tenant_id: tenantId, name: groupName })
          .select("id")
          .single();
        if (structErr) {
          warnings.push(`Failed to create structure for group "${groupName}": ${structErr.message}`);
          continue;
        }
        structureId = newStruct.id;
        groupsCreated++;
      }

      // Link members to the structure
      const rawMembers = group.Members?.Client || group.Members || group.Clients || [];
      const members = Array.isArray(rawMembers) ? rawMembers : [rawMembers].filter(Boolean);

      for (const member of members) {
        const memberUuid = member.UUID || member.ClientUUID;
        if (!memberUuid) continue;

        const entityId = xeroUuidToEntityId.get(memberUuid);
        if (!entityId) continue;

        await supabase
          .from("structure_entities")
          .upsert(
            { structure_id: structureId, entity_id: entityId },
            { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
          );
      }

      // Link relationships belonging to group members to the structure
      const memberEntityIds = members
        .map((m: any) => xeroUuidToEntityId.get(m.UUID || m.ClientUUID))
        .filter(Boolean);

      if (memberEntityIds.length > 0) {
        const { data: groupRels } = await supabase
          .from("relationships")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("from_entity_id", memberEntityIds)
          .is("deleted_at", null);

        if (groupRels) {
          for (const rel of groupRels) {
            await supabase
              .from("structure_relationships")
              .upsert(
                { structure_id: structureId, relationship_id: rel.id },
                { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
              );
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // STEP 5: Fetch /client/{uuid}/customfield — ownership metadata
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 5: Fetching custom fields for ownership data...");

    const ownershipKeywords = ["ownership", "shareholding", "unit", "holding", "percent", "share %", "units held"];

    for (const cd of clientDetails) {
      const cfData = await xpmGet(`/client/${cd.uuid}/customfield`, accessToken, xeroTenantId);
      if (!cfData) continue;

      const rawFields = cfData?.CustomFieldList?.CustomField
        || cfData?.CustomFields
        || cfData?.CustomFieldList
        || [];
      const fields = Array.isArray(rawFields) ? rawFields : [rawFields].filter(Boolean);

      for (const field of fields) {
        const fieldName = (field.Name || field.Label || "").toLowerCase();
        const fieldValue = field.Value || field.Text || "";

        if (!fieldValue) continue;

        const isOwnershipField = ownershipKeywords.some((kw) => fieldName.includes(kw));
        if (!isOwnershipField) continue;

        // Try to parse as a percentage and update matching relationships
        const numericValue = parseFloat(fieldValue.replace(/[^0-9.]/g, ""));
        if (isNaN(numericValue)) continue;

        const entityId = xeroUuidToEntityId.get(cd.uuid);
        if (!entityId) continue;

        // Update shareholder/beneficiary/member relationships where this entity is the "from"
        const isPercentage = fieldName.includes("percent") || fieldName.includes("%") || numericValue <= 100;
        const isUnits = fieldName.includes("unit") || fieldName.includes("holding");

        const updatePayload: Record<string, any> = {};
        if (isUnits && !isPercentage) {
          updatePayload.ownership_units = numericValue;
        } else {
          updatePayload.ownership_percent = numericValue;
        }

        if (Object.keys(updatePayload).length > 0) {
          const { error: updateErr } = await supabase
            .from("relationships")
            .update(updatePayload)
            .eq("tenant_id", tenantId)
            .eq("from_entity_id", entityId)
            .in("relationship_type", ["shareholder", "beneficiary", "member"])
            .is("deleted_at", null);

          if (updateErr) {
            warnings.push(`Failed to update ownership for "${cd.name}": ${updateErr.message}`);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // STEP 6: Fetch staff list
    // ════════════════════════════════════════════════════════════════
    console.log("[sync-xpm] Step 6: Fetching staff...");
    const staffData = await xpmGet("/staff/list", accessToken, xeroTenantId);
    const staffList: { id: string; name: string; email: string | null; role: string | null }[] = [];

    if (staffData) {
      const rawStaff = staffData?.StaffList?.Staff || staffData?.Staff || staffData?.StaffList || [];
      const staffArray = Array.isArray(rawStaff) ? rawStaff : [rawStaff].filter(Boolean);
      staffFetched = staffArray.length;

      for (const staff of staffArray) {
        const staffName = staff.Name || `${staff.FirstName || ""} ${staff.LastName || ""}`.trim();
        const staffEmail = staff.Email || staff.EmailAddress || null;
        if (!staffName) continue;

        staffList.push({
          id: staff.StaffID || staff.ID || staff.UUID || crypto.randomUUID(),
          name: staffName,
          email: staffEmail,
          role: staff.Role || staff.Position || null,
        });

        // Create staff as Individual entities
        const { data: existingStaff } = await supabase
          .from("entities")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("name", staffName)
          .eq("entity_type", "Individual")
          .is("deleted_at", null)
          .maybeSingle();

        if (!existingStaff) {
          const { data: newStaff, error: staffErr } = await supabase
            .from("entities")
            .insert({
              tenant_id: tenantId,
              name: staffName,
              entity_type: "Individual",
              source: "imported",
            })
            .select("id")
            .single();

          if (staffErr) {
            warnings.push(`Failed to create staff entity "${staffName}": ${staffErr.message}`);
          } else if (newStaff) {
            entitiesCreated++;
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Fallback: create "XPM Import" structure if no groups exist
    // ════════════════════════════════════════════════════════════════
    if (groups.length === 0 && (entitiesCreated > 0 || entitiesUpdated > 0)) {
      const { data: fallbackStruct } = await supabase
        .from("structures")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", "XPM Import")
        .is("deleted_at", null)
        .maybeSingle();

      let structureId: string | null = fallbackStruct?.id || null;
      if (!structureId) {
        const { data: newStruct } = await supabase
          .from("structures")
          .insert({ tenant_id: tenantId, name: "XPM Import" })
          .select("id")
          .single();
        if (newStruct) structureId = newStruct.id;
      }

      if (structureId) {
        const entityIds = Array.from(xeroUuidToEntityId.values());
        for (const entityId of entityIds) {
          await supabase
            .from("structure_entities")
            .upsert(
              { structure_id: structureId, entity_id: entityId },
              { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
            );
        }

        // Link all imported relationships
        const { data: allRels } = await supabase
          .from("relationships")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("source", "imported")
          .is("deleted_at", null);

        if (allRels) {
          for (const rel of allRels) {
            await supabase
              .from("structure_relationships")
              .upsert(
                { structure_id: structureId, relationship_id: rel.id },
                { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
              );
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Import log
    // ════════════════════════════════════════════════════════════════
    const result = {
      success: true,
      dataSource: "practicemanager_3.1",
      clientsFetched: clientDetails.length,
      entitiesCreated,
      entitiesUpdated,
      relationshipsCreated,
      relationshipsSkipped,
      groupsFound: groups.length,
      groupsCreated,
      trusteesDetected,
      staffFetched,
      staffList,
      typeCounts,
      warnings,
    };

    await supabase.from("import_logs").insert({
      tenant_id: tenantId,
      user_id: user.id,
      file_name: "xpm-sync-3.1",
      status: "completed",
      result,
    });

    console.log("[sync-xpm] Result:", JSON.stringify({ ...result, staffList: `${staffList.length} items` }));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sync-xpm] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
