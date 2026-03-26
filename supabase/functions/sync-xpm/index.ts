import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// ── XPM client type mapping ─────────────────────────────────────────
const XPM_CLIENT_TYPE_MAP: Record<string, string> = {
  Company: "Company",
  Individual: "Individual",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  Trust: "Trust",
  SuperFund: "smsf",
  "Super Fund": "smsf",
  SMSF: "smsf",
};

// ── Detect corporate trustee from name ──────────────────────────────
function isCorporateTrustee(name: string, entityType: string): boolean {
  if (entityType !== "Company") return false;
  const lower = name.toLowerCase();
  return (
    lower.includes("as trustee for") ||
    lower.includes("atf ") ||
    lower.includes(" atf") ||
    /\btrustee\b/.test(lower)
  );
}

// ── Extract trust name from trustee pattern ─────────────────────────
function extractTrustName(name: string): string | null {
  // "ABC Pty Ltd as Trustee for XYZ Trust" → "XYZ Trust"
  const atfMatch = name.match(/(?:as\s+trustee\s+for|atf)\s+(.+)/i);
  return atfMatch ? atfMatch[1].trim() : null;
}

// ── Fetch XPM clients via Practice Manager API ─────────────────────
async function fetchXpmClients(accessToken: string, xeroTenantId: string): Promise<any[] | null> {
  try {
    console.log("[sync-xpm] Attempting Practice Manager API...");
    const res = await fetch("https://api.xero.com/practicemanager/3.0/client.api/list", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
        Accept: "application/json",
      },
    });

    if (res.status === 403 || res.status === 401) {
      console.log("[sync-xpm] XPM API not authorized, falling back to Accounting API");
      return null;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[sync-xpm] XPM API returned ${res.status}: ${errText}`);
      return null;
    }

    const data = await res.json();
    const clients = data?.Clients || data?.ClientList || [];
    console.log(`[sync-xpm] XPM returned ${clients.length} clients`);
    return Array.isArray(clients) ? clients : null;
  } catch (err) {
    console.warn("[sync-xpm] XPM API call failed:", err);
    return null;
  }
}

// ── Normalize XPM client to a common contact shape ─────────────────
function xpmClientToContact(client: any): any {
  return {
    ContactID: client.ClientID || client.ID || client.ClientUUID || crypto.randomUUID(),
    Name: client.Name || `${client.FirstName || ""} ${client.LastName || ""}`.trim(),
    FirstName: client.FirstName || null,
    LastName: client.LastName || null,
    EmailAddress: client.Email || client.EmailAddress || null,
    TaxNumber: client.TaxNumber || client.ABN || null,
    ContactStatus: "ACTIVE",
    IsCustomer: true,
    IsSupplier: false,
    _xpmClientType: client.ClientType || client.Type || null,
    _fromXpm: true,
  };
}

// ── Fetch all contacts with pagination (Accounting API fallback) ───
async function fetchAllContacts(accessToken: string, xeroTenantId: string): Promise<any[]> {
  const allContacts: any[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/Contacts?page=${page}&includeArchived=false`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[sync-xpm] Contacts fetch failed (page ${page}):`, res.status, errText);
      throw new Error(`Failed to fetch Xero contacts: ${res.status}`);
    }

    const data = await res.json();
    const contacts = data.Contacts || [];
    allContacts.push(...contacts);

    if (contacts.length < 100) break;
    page++;
  }

  return allContacts;
}

// ── Guess entity type from contact data ─────────────────────────────
function guessEntityType(contact: any): string {
  if (contact._fromXpm && contact._xpmClientType) {
    const mapped = XPM_CLIENT_TYPE_MAP[contact._xpmClientType];
    if (mapped) return mapped;
  }

  const name = (contact.Name || "").toLowerCase();
  const isOrg = contact.IsCustomer || contact.IsSupplier;

  if (name.includes("trust") || name.includes("as trustee for") || name.includes("atf")) {
    if (name.includes("smsf") || name.includes("superannuation") || name.includes("super fund")) return "smsf";
    if (name.includes("discretionary")) return "trust_discretionary";
    if (name.includes("unit trust")) return "trust_unit";
    if (name.includes("family trust")) return "trust_family";
    return "Trust";
  }

  if (name.includes("pty") || name.includes("ltd") || name.includes("limited") || name.includes("inc")) {
    return "Company";
  }

  if (name.includes("partnership") || (name.includes(" & ") && !name.includes("pty"))) {
    return "Partnership";
  }

  if (contact.FirstName && contact.LastName && !isOrg) {
    return "Individual";
  }

  return "Unclassified";
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
    const xeroTenantId = connection.xero_tenant_id;
    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not set on connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessToken(supabase, connection);

    // ── Try XPM first, fall back to Accounting API ──
    let contacts: any[];
    let dataSource = "accounting";
    const xpmClients = await fetchXpmClients(accessToken, xeroTenantId);

    if (xpmClients && xpmClients.length > 0) {
      contacts = xpmClients.map(xpmClientToContact);
      dataSource = "practicemanager";
      console.log(`[sync-xpm] Using Practice Manager data: ${contacts.length} clients`);
    } else {
      console.log("[sync-xpm] Falling back to Accounting API...");
      contacts = await fetchAllContacts(accessToken, xeroTenantId);
      console.log(`[sync-xpm] Fetched ${contacts.length} contacts via Accounting API`);
    }

    const warnings: string[] = [];
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let trusteesDetected = 0;
    let relationshipsCreated = 0;

    const xeroIdToEntityId = new Map<string, string>();
    // Track trustee→trust pairings for relationship creation
    const trusteePairs: { trusteeEntityId: string; trustName: string }[] = [];

    // ── Stats counters ──
    const typeCounts: Record<string, number> = {};

    for (const contact of contacts) {
      const contactId = contact.ContactID;
      const name = contact.Name;
      if (!name) continue;

      const entityType = guessEntityType(contact);
      const abn = contact.TaxNumber || null;
      const trusteeCompany = isCorporateTrustee(name, entityType);

      typeCounts[entityType] = (typeCounts[entityType] || 0) + 1;
      if (trusteeCompany) trusteesDetected++;

      let existingEntity: { id: string; entity_type: string; xpm_uuid: string | null; abn: string | null; is_trustee_company: boolean } | null = null;

      if (contactId) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid, abn, is_trustee_company")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", contactId)
          .is("deleted_at", null)
          .maybeSingle();
        existingEntity = data;
      }

      if (!existingEntity) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid, abn, is_trustee_company")
          .eq("tenant_id", tenantId)
          .eq("name", name)
          .is("deleted_at", null)
          .maybeSingle();
        existingEntity = data;
      }

      if (existingEntity) {
        const updates: Record<string, any> = {};
        if (entityType !== "Unclassified" && existingEntity.entity_type === "Unclassified") {
          updates.entity_type = entityType;
        }
        if (!existingEntity.xpm_uuid && contactId) {
          updates.xpm_uuid = contactId;
        }
        if (abn && !existingEntity.abn) {
          updates.abn = abn;
        }
        if (trusteeCompany && !existingEntity.is_trustee_company) {
          updates.is_trustee_company = true;
        }
        if (Object.keys(updates).length > 0) {
          updates.source = "imported";
          await supabase.from("entities").update(updates).eq("id", existingEntity.id);
          entitiesUpdated++;
        }
        xeroIdToEntityId.set(contactId, existingEntity.id);

        // Track trustee pair
        if (trusteeCompany) {
          const trustName = extractTrustName(name);
          if (trustName) {
            trusteePairs.push({ trusteeEntityId: existingEntity.id, trustName });
          }
        }
      } else {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            tenant_id: tenantId,
            name,
            xpm_uuid: contactId || null,
            entity_type: entityType,
            abn: abn,
            is_trustee_company: trusteeCompany,
            source: "imported",
          })
          .select("id")
          .single();

        if (error) {
          warnings.push(`Failed to create entity "${name}": ${error.message}`);
          continue;
        }
        xeroIdToEntityId.set(contactId, data.id);
        entitiesCreated++;

        // Track trustee pair
        if (trusteeCompany) {
          const trustName = extractTrustName(name);
          if (trustName) {
            trusteePairs.push({ trusteeEntityId: data.id, trustName });
          }
        }
      }
    }

    // ── Auto-create trustee relationships ────────────────────────────
    for (const pair of trusteePairs) {
      // Find the trust entity by name
      const { data: trustEntity } = await supabase
        .from("entities")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", `%${pair.trustName}%`)
        .is("deleted_at", null)
        .maybeSingle();

      if (trustEntity) {
        // Check if relationship already exists
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

          if (!relErr) {
            relationshipsCreated++;
          } else {
            warnings.push(`Failed to create trustee relationship for "${pair.trustName}": ${relErr.message}`);
          }
        }
      }
    }

    // ── Auto-create a structure if none exists ────────────────────────
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
      const entityIds = Array.from(xeroIdToEntityId.values());
      for (const entityId of entityIds) {
        await supabase
          .from("structure_entities")
          .upsert(
            { structure_id: structureId, entity_id: entityId },
            { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
          );
      }

      // Link trustee relationships to structure
      if (relationshipsCreated > 0) {
        const { data: relIds } = await supabase
          .from("relationships")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("source", "imported")
          .eq("relationship_type", "trustee")
          .is("deleted_at", null);

        if (relIds) {
          for (const rel of relIds) {
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

    const result = {
      success: true,
      dataSource,
      contactsFetched: contacts.length,
      entitiesCreated,
      entitiesUpdated,
      trusteesDetected,
      relationshipsCreated,
      structureId,
      typeCounts,
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
