import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Entity type mapping from Xero ContactGroups / heuristics ────────────
const ENTITY_TYPE_MAP: Record<string, string> = {
  individual: "Individual",
  company: "Company",
  partnership: "Partnership",
  "sole trader": "Sole Trader",
  trust: "Trust",
  smsf: "smsf",
};

// ── Token refresh ───────────────────────────────────────────────────────
async function refreshAccessToken(
  supabase: any,
  connection: any,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);

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

// ── Fetch all contacts with pagination ──────────────────────────────────
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

    // Xero returns up to 100 contacts per page
    if (contacts.length < 100) break;
    page++;
  }

  return allContacts;
}

// ── Guess entity type from contact data ─────────────────────────────────
function guessEntityType(contact: any): string {
  const name = (contact.Name || "").toLowerCase();
  const isOrg = contact.IsCustomer || contact.IsSupplier;

  // Trust indicators
  if (name.includes("trust") || name.includes("as trustee for") || name.includes("atf")) {
    if (name.includes("smsf") || name.includes("superannuation") || name.includes("super fund")) return "smsf";
    if (name.includes("discretionary")) return "trust_discretionary";
    if (name.includes("unit trust")) return "trust_unit";
    if (name.includes("family trust")) return "trust_family";
    return "Trust";
  }

  // Company indicators
  if (name.includes("pty") || name.includes("ltd") || name.includes("limited") || name.includes("inc")) {
    return "Company";
  }

  // Partnership indicators
  if (name.includes("partnership") || name.includes(" & ") && !name.includes("pty")) {
    return "Partnership";
  }

  // If it has a first + last name and no company markers, likely Individual
  if (contact.FirstName && contact.LastName && !isOrg) {
    return "Individual";
  }

  return "Unclassified";
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

    // Refresh token if needed
    const accessToken = await refreshAccessToken(supabase, connection);

    // ── Fetch Contacts via Accounting API ────────────────────────────────
    console.log("[sync-xpm] Fetching contacts via accounting API...");
    const contacts = await fetchAllContacts(accessToken, xeroTenantId);
    console.log(`[sync-xpm] Fetched ${contacts.length} contacts`);

    const warnings: string[] = [];
    let entitiesCreated = 0;
    let entitiesUpdated = 0;

    // Map Xero ContactID → our entity id
    const xeroIdToEntityId = new Map<string, string>();

    for (const contact of contacts) {
      const contactId = contact.ContactID;
      const name = contact.Name;
      if (!name) continue;

      const entityType = guessEntityType(contact);

      // Try to find existing entity by xpm_uuid (we store ContactID there)
      let existingEntity: { id: string; entity_type: string; xpm_uuid: string | null } | null = null;

      if (contactId) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", contactId)
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
        if (!existingEntity.xpm_uuid && contactId) {
          updates.xpm_uuid = contactId;
        }
        if (Object.keys(updates).length > 0) {
          updates.source = "imported";
          await supabase.from("entities").update(updates).eq("id", existingEntity.id);
          entitiesUpdated++;
        }
        xeroIdToEntityId.set(contactId, existingEntity.id);
      } else {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            tenant_id: tenantId,
            name,
            xpm_uuid: contactId || null,
            entity_type: entityType,
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
    }

    const result = {
      success: true,
      contactsFetched: contacts.length,
      entitiesCreated,
      entitiesUpdated,
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
