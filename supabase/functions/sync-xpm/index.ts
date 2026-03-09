import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Entity type mapping from XPM ClientType ─────────────────────────────
const ENTITY_TYPE_MAP: Record<string, string> = {
  individual: "Individual",
  company: "Company",
  partnership: "Partnership",
  "sole trader": "Sole Trader",
  trust: "Trust",
  "discretionary trust": "trust_discretionary",
  "unit trust": "trust_unit",
  "hybrid trust": "trust_hybrid",
  "bare trust": "trust_bare",
  "testamentary trust": "trust_testamentary",
  "deceased estate": "trust_deceased_estate",
  "family trust": "trust_family",
  "self managed superannuation fund": "smsf",
  smsf: "smsf",
  "incorporated association/club": "Incorporated Association/Club",
};

// ── Relationship type mapping from XPM ──────────────────────────────────
const REL_TYPE_MAP: Record<string, string> = {
  director: "director",
  "director of": "director",
  shareholder: "shareholder",
  "shareholder of": "shareholder",
  beneficiary: "beneficiary",
  "beneficiary of": "beneficiary",
  trustee: "trustee",
  "trustee of": "trustee",
  appointer: "appointer",
  "appointer of": "appointer",
  settlor: "settlor",
  "settlor of": "settlor",
  partner: "partner",
  "partner of": "partner",
  spouse: "spouse",
  parent: "parent",
  "parent of": "parent",
  child: "child",
  "child of": "child",
  member: "member",
  "member of": "member",
};

// ── XML parsing helpers ─────────────────────────────────────────────────
function getTagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function getAllRecords(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]);
  }
  return results;
}

// ── Token refresh ───────────────────────────────────────────────────────
async function refreshAccessToken(
  supabase: any,
  connection: any,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);

  // If token is still valid (with 2min buffer), return it
  if (expiresAt.getTime() - now.getTime() > 120_000) {
    return connection.access_token;
  }

  console.log("[sync-xpm] Token expired, refreshing...");
  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from("xero_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

// ── Main ────────────────────────────────────────────────────────────────
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

    // Load Xero connection for this tenant
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
    const xeroTenantId = connection.xero_tenant_id;
    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not set on connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh token if needed
    const accessToken = await refreshAccessToken(supabase, connection);

    const xeroHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": xeroTenantId,
      Accept: "application/xml",
    };

    // ── Fetch Clients ─────────────────────────────────────────────────
    console.log("[sync-xpm] Fetching clients...");
    const clientsRes = await fetch(
      "https://api.xero.com/practicemanager/3.0/clients",
      { headers: xeroHeaders },
    );
    if (!clientsRes.ok) {
      const errText = await clientsRes.text();
      console.error("[sync-xpm] Clients fetch failed:", clientsRes.status, errText);
      throw new Error(`Failed to fetch XPM clients: ${clientsRes.status}`);
    }
    const clientsXml = await clientsRes.text();

    // ── Fetch Client Relationships ────────────────────────────────────
    console.log("[sync-xpm] Fetching client relationships...");
    const relsRes = await fetch(
      "https://api.xero.com/practicemanager/3.0/clientrelationships",
      { headers: xeroHeaders },
    );
    if (!relsRes.ok) {
      const errText = await relsRes.text();
      console.error("[sync-xpm] Relationships fetch failed:", relsRes.status, errText);
      throw new Error(`Failed to fetch XPM relationships: ${relsRes.status}`);
    }
    const relsXml = await relsRes.text();

    // ── Parse clients ─────────────────────────────────────────────────
    const clientRecords = getAllRecords(clientsXml, "Client");
    console.log(`[sync-xpm] Parsed ${clientRecords.length} clients`);

    const warnings: string[] = [];
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let relationshipsCreated = 0;
    let relationshipsSkipped = 0;

    // Map XPM ClientID → our entity id
    const xpmIdToEntityId = new Map<string, string>();

    for (const rec of clientRecords) {
      const clientId = getTagText(rec, "ID");
      const name = getTagText(rec, "Name");
      const clientType = getTagText(rec, "Type") || getTagText(rec, "ClientType");
      const uuid = getTagText(rec, "UUID");

      if (!name) continue;

      const entityType = ENTITY_TYPE_MAP[clientType.toLowerCase()] ?? "Unclassified";

      // Try to find existing entity by xpm_uuid first, then by name
      let existingEntity: { id: string; entity_type: string; xpm_uuid: string | null } | null = null;

      if (uuid) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", uuid)
          .is("deleted_at", null)
          .maybeSingle();
        existingEntity = data;
      }

      if (!existingEntity && clientId) {
        // Also try matching by xpm_uuid = clientId (for XPM IDs stored previously)
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", clientId)
          .is("deleted_at", null)
          .maybeSingle();
        existingEntity = data;
      }

      if (!existingEntity) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("name", name)
          .is("deleted_at", null)
          .maybeSingle();
        existingEntity = data;
      }

      if (existingEntity) {
        const updates: Record<string, string> = {};
        if (entityType !== "Unclassified" && existingEntity.entity_type === "Unclassified") {
          updates.entity_type = entityType;
        }
        if (!existingEntity.xpm_uuid && (uuid || clientId)) {
          updates.xpm_uuid = uuid || clientId;
        }
        if (Object.keys(updates).length > 0) {
          updates.source = "imported";
          await supabase.from("entities").update(updates).eq("id", existingEntity.id);
          entitiesUpdated++;
        }
        xpmIdToEntityId.set(clientId, existingEntity.id);
      } else {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            tenant_id: tenantId,
            name,
            xpm_uuid: uuid || clientId || null,
            entity_type: entityType,
            source: "imported",
          })
          .select("id")
          .single();

        if (error) {
          warnings.push(`Failed to create entity "${name}": ${error.message}`);
          continue;
        }
        xpmIdToEntityId.set(clientId, data.id);
        entitiesCreated++;
      }
    }

    // ── Parse relationships ───────────────────────────────────────────
    const relRecords = getAllRecords(relsXml, "ClientRelationship");
    console.log(`[sync-xpm] Parsed ${relRecords.length} relationships`);

    const relDedupeSet = new Set<string>();

    for (const rec of relRecords) {
      const relType = getTagText(rec, "RelationshipType") || getTagText(rec, "Type");
      const clientId = getTagText(rec, "ClientID") || getTagText(getTagText(rec, "Client"), "ID");
      const relatedClientId = getTagText(rec, "RelatedClientID") || getTagText(getTagText(rec, "RelatedClient"), "ID");
      const ownershipStr = getTagText(rec, "Percentage") || getTagText(rec, "OwnershipPercentage");

      if (!relType || !clientId || !relatedClientId) {
        relationshipsSkipped++;
        continue;
      }

      const mappedType = REL_TYPE_MAP[relType.toLowerCase()];
      if (!mappedType) {
        warnings.push(`Unknown relationship type "${relType}"`);
        relationshipsSkipped++;
        continue;
      }

      let fromId = xpmIdToEntityId.get(clientId);
      let toId = xpmIdToEntityId.get(relatedClientId);

      if (!fromId || !toId) {
        warnings.push(`Could not resolve entities for relationship: clientId=${clientId}, relatedClientId=${relatedClientId}`);
        relationshipsSkipped++;
        continue;
      }

      // Canonical direction for symmetric relationships
      if (mappedType === "spouse" || mappedType === "partner") {
        if (fromId > toId) [fromId, toId] = [toId, fromId];
      }

      const dedupeKey = `${mappedType}:${fromId}:${toId}`;
      if (relDedupeSet.has(dedupeKey)) continue;
      relDedupeSet.add(dedupeKey);

      // Check existing
      const { data: existingRel } = await supabase
        .from("relationships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("from_entity_id", fromId)
        .eq("to_entity_id", toId)
        .eq("relationship_type", mappedType)
        .is("deleted_at", null)
        .maybeSingle();

      if (existingRel) {
        // Update ownership if provided
        if (ownershipStr) {
          const pct = parseFloat(ownershipStr);
          if (!isNaN(pct)) {
            await supabase
              .from("relationships")
              .update({ ownership_percent: pct, source: "imported" })
              .eq("id", existingRel.id);
          }
        }
        continue;
      }

      const insertData: Record<string, any> = {
        tenant_id: tenantId,
        from_entity_id: fromId,
        to_entity_id: toId,
        relationship_type: mappedType,
        source: "imported",
        confidence: "imported",
      };

      if (ownershipStr) {
        const pct = parseFloat(ownershipStr);
        if (!isNaN(pct)) insertData.ownership_percent = pct;
      }

      const { error: relErr } = await supabase
        .from("relationships")
        .insert(insertData);

      if (relErr) {
        warnings.push(`Failed to create relationship ${mappedType}: ${relErr.message}`);
        relationshipsSkipped++;
        continue;
      }

      relationshipsCreated++;
    }

    // ── Auto-create a structure if none exists ────────────────────────
    // Check if there's a structure named "XPM Import" and link new entities to it
    let structureId: string | null = null;
    const { data: existingStruct } = await supabase
      .from("structures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", "XPM Import")
      .is("deleted_at", null)
      .maybeSingle();

    if (existingStruct) {
      structureId = existingStruct.id;
    } else if (entitiesCreated > 0 || entitiesUpdated > 0) {
      const { data: newStruct } = await supabase
        .from("structures")
        .insert({ tenant_id: tenantId, name: "XPM Import" })
        .select("id")
        .single();
      if (newStruct) structureId = newStruct.id;
    }

    // Link all synced entities to the structure
    if (structureId) {
      const entityIds = Array.from(xpmIdToEntityId.values());
      for (const entityId of entityIds) {
        await supabase
          .from("structure_entities")
          .upsert(
            { structure_id: structureId, entity_id: entityId },
            { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
          );
      }

      // Link relationships too
      const { data: allRels } = await supabase
        .from("relationships")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .in("from_entity_id", entityIds)
        .in("to_entity_id", entityIds);

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

    const result = {
      success: true,
      clientsFetched: clientRecords.length,
      relationshipsFetched: relRecords.length,
      entitiesCreated,
      entitiesUpdated,
      relationshipsCreated,
      relationshipsSkipped,
      structureId,
      warnings,
    };

    console.log("[sync-xpm] Result:", JSON.stringify(result));

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
