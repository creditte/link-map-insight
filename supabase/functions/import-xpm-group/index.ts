import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken } from "../_shared/crypto.ts";
import { parse as parseXml } from "https://deno.land/x/xml@6.0.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);

  if (expiresAt.getTime() - now.getTime() > 300_000) return currentAccessToken;

  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const currentRefreshToken = await decryptToken(connection.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: currentRefreshToken }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);

  const tokens = await res.json();
  const { encryptToken } = await import("../_shared/crypto.ts");
  await supabase.from("xero_connections").update({
    access_token: await encryptToken(tokens.access_token),
    refresh_token: await encryptToken(tokens.refresh_token),
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);

  return tokens.access_token;
}

function xpmHeaders(accessToken: string, xeroTenantId: string) {
  return { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": xeroTenantId, Accept: "application/xml" };
}

async function xpmGetXml(path: string, accessToken: string, xeroTenantId: string) {
  const res = await fetch(`${XPM_BASE}${path}`, { headers: xpmHeaders(accessToken, xeroTenantId) });
  if (!res.ok) return null;
  try { return parseXml(await res.text()); } catch { return null; }
}

function xmlArray(parent: any, key: string): any[] {
  if (!parent) return [];
  const val = parent[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function xmlText(node: any, key: string): string {
  if (!node) return "";
  const val = node[key];
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val["#text"] !== undefined) return String(val["#text"]);
  return String(val);
}

async function discoverPmTenantId(accessToken: string, storedTenantId: string | null): Promise<string | null> {
  try {
    const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const conns = await res.json();
      const pm = conns.find((c: any) => c.tenantType === "PRACTICEMANAGER");
      if (pm) return pm.tenantId;
    }
  } catch {}
  return storedTenantId;
}

const BUSINESS_STRUCTURE_MAP: Record<string, string> = {
  Individual: "Individual", Company: "Company", Trust: "Trust", Partnership: "Partnership",
  "Sole Trader": "Sole Trader", "Trustee Company": "Company",
  "Discretionary Trust": "trust_discretionary", "Unit Trust": "trust_unit",
  "Hybrid Trust": "trust_hybrid", "Bare Trust": "trust_bare",
  "Testamentary Trust": "trust_testamentary", "Deceased Estate": "trust_deceased_estate",
  "Family Trust": "trust_family", "Self Managed Superannuation Fund": "smsf",
  SMSF: "smsf", "Super Fund": "smsf", SuperFund: "smsf",
};

function resolveEntityType(bs?: string): string {
  if (!bs) return "Unclassified";
  const mapped = BUSINESS_STRUCTURE_MAP[bs];
  if (mapped) return mapped;
  const lower = bs.toLowerCase();
  for (const [k, v] of Object.entries(BUSINESS_STRUCTURE_MAP)) {
    if (k.toLowerCase() === lower) return v;
  }
  return "Unclassified";
}

const REL_TYPE_MAP: Record<string, string> = {
  "director of": "director", director: "director", "trustee of": "trustee", trustee: "trustee",
  "shareholder of": "shareholder", shareholder: "shareholder", "beneficiary of": "beneficiary",
  beneficiary: "beneficiary", "partner of": "partner", partner: "partner",
  "appointer of": "appointer", "appointor of": "appointer", appointer: "appointer", appointor: "appointer",
  "settlor of": "settlor", settlor: "settlor", "member of": "member", member: "member",
  "spouse of": "spouse", spouse: "spouse", "parent of": "parent", parent: "parent",
  "child of": "child", child: "child",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);
    const anonClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const groupUuid = body.group_uuid;
    const groupName = body.group_name || "XPM Group";
    if (!groupUuid) {
      return new Response(JSON.stringify({ error: "group_uuid is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load Xero connection
    const { data: connections } = await supabase.from("xero_connections").select("*").eq("tenant_id", tenantId).order("connected_at", { ascending: false }).limit(1);
    if (!connections?.length) {
      return new Response(JSON.stringify({ error: "No Xero connection found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const connection = connections[0];
    const accessToken = await refreshAccessToken(supabase, connection);
    const xeroTenantId = await discoverPmTenantId(accessToken, connection.xero_tenant_id);
    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "Xero tenant ID not available" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch group members
    const groupXml = await xpmGetXml(`/clientgroup.api/get/${groupUuid}`, accessToken, xeroTenantId);
    if (!groupXml) {
      return new Response(JSON.stringify({ error: "Failed to fetch group from XPM" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const groupDetail = groupXml?.Response?.Group;
    const members = xmlArray(groupDetail?.Clients, "Client");
    const memberUuids = members.map((m: any) => xmlText(m, "UUID")).filter(Boolean);

    // Fetch each member's details
    interface ClientData {
      uuid: string; name: string; entityType: string; abn: string | null; acn: string | null;
      businessStructure: string;
      relationships: Array<{ type: string; relatedUuid: string; relatedName: string; percentage: number | null; shares: number | null }>;
    }

    const clients: ClientData[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < memberUuids.length; i += BATCH_SIZE) {
      const batch = memberUuids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (uuid: string) => {
        const xml = await xpmGetXml(`/client.api/get/${uuid}`, accessToken, xeroTenantId);
        if (!xml) return null;
        const c = xml?.Response?.Client;
        if (!c) return null;

        const name = xmlText(c, "Name") || `${xmlText(c, "FirstName")} ${xmlText(c, "LastName")}`.trim();
        const bs = xmlText(c, "BusinessStructure");
        const rels: ClientData["relationships"] = [];

        for (const rel of xmlArray(c?.Relationships, "Relationship")) {
          const typeRaw = (xmlText(rel, "Type") || xmlText(rel, "RelationshipType")).trim().toLowerCase();
          const rc = rel?.RelatedClient;
          const relUuid = xmlText(rc, "UUID") || xmlText(rel, "RelatedClientUUID");
          const relName = xmlText(rc, "Name") || xmlText(rel, "RelatedClientName");
          const pct = parseFloat(xmlText(rel, "Percentage") || xmlText(rel, "OwnershipPercentage"));
          const shares = parseFloat(xmlText(rel, "NumberOfShares"));
          const mapped = REL_TYPE_MAP[typeRaw] || typeRaw;

          if (relUuid) {
            rels.push({ type: mapped, relatedUuid: relUuid, relatedName: relName, percentage: isNaN(pct) ? null : pct, shares: isNaN(shares) ? null : shares });
          }
        }

        return { uuid, name, entityType: resolveEntityType(bs), abn: xmlText(c, "TaxNumber") || xmlText(c, "ABN") || null, acn: xmlText(c, "CompanyNumber") || xmlText(c, "ACN") || null, businessStructure: bs, relationships: rels } as ClientData;
      }));
      for (const r of results) if (r) clients.push(r);
    }

    // Create structure
    const { data: structure, error: structErr } = await supabase.from("structures").insert({
      name: groupName,
      tenant_id: tenantId,
      layout_mode: "auto",
    }).select("id").single();

    if (structErr || !structure) {
      return new Response(JSON.stringify({ error: "Failed to create structure", detail: structErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const structureId = structure.id;

    // Upsert entities (keyed by xpm_uuid to avoid duplicates)
    const xpmUuidToEntityId: Record<string, string> = {};

    // Check for existing entities with these xpm_uuids
    const { data: existingEntities } = await supabase.from("entities").select("id, xpm_uuid").eq("tenant_id", tenantId).in("xpm_uuid", clients.map(c => c.uuid));
    for (const e of existingEntities ?? []) {
      if (e.xpm_uuid) xpmUuidToEntityId[e.xpm_uuid] = e.id;
    }

    // Create missing entities
    const newEntities = clients.filter(c => !xpmUuidToEntityId[c.uuid]);
    if (newEntities.length > 0) {
      const { data: inserted, error: entErr } = await supabase.from("entities").insert(
        newEntities.map(c => ({
          name: c.name,
          entity_type: c.entityType,
          tenant_id: tenantId,
          source: "imported" as const,
          abn: c.abn,
          acn: c.acn,
          xpm_uuid: c.uuid,
        }))
      ).select("id, xpm_uuid");

      if (entErr) {
        console.error("[import-xpm-group] Entity insert error:", entErr);
      }

      for (const e of inserted ?? []) {
        if (e.xpm_uuid) xpmUuidToEntityId[e.xpm_uuid] = e.id;
      }
    }

    // Link entities to structure
    const structureEntities = Object.values(xpmUuidToEntityId).map(entityId => ({
      structure_id: structureId,
      entity_id: entityId,
    }));

    if (structureEntities.length > 0) {
      await supabase.from("structure_entities").insert(structureEntities);
    }

    // Create relationships
    const memberSet = new Set(clients.map(c => c.uuid));
    const relDedupeSet = new Set<string>();
    const relsToInsert: Array<{
      from_entity_id: string; to_entity_id: string; relationship_type: string;
      tenant_id: string; source: string; ownership_percent: number | null; ownership_units: number | null;
    }> = [];

    for (const client of clients) {
      const fromEntityId = xpmUuidToEntityId[client.uuid];
      if (!fromEntityId) continue;

      for (const rel of client.relationships) {
        if (!memberSet.has(rel.relatedUuid)) continue;
        const toEntityId = xpmUuidToEntityId[rel.relatedUuid];
        if (!toEntityId) continue;

        const dedupeKey = `${rel.type}:${fromEntityId}:${toEntityId}`;
        const reverseKey = `${rel.type}:${toEntityId}:${fromEntityId}`;
        if (relDedupeSet.has(dedupeKey) || relDedupeSet.has(reverseKey)) continue;
        relDedupeSet.add(dedupeKey);

        relsToInsert.push({
          from_entity_id: fromEntityId,
          to_entity_id: toEntityId,
          relationship_type: rel.type,
          tenant_id: tenantId,
          source: "imported",
          ownership_percent: rel.percentage,
          ownership_units: rel.shares,
        });
      }
    }

    const insertedRelIds: string[] = [];
    if (relsToInsert.length > 0) {
      const { data: insertedRels, error: relErr } = await supabase.from("relationships").insert(relsToInsert).select("id");
      if (relErr) console.error("[import-xpm-group] Relationship insert error:", relErr);
      for (const r of insertedRels ?? []) insertedRelIds.push(r.id);
    }

    // Link relationships to structure
    if (insertedRelIds.length > 0) {
      await supabase.from("structure_relationships").insert(
        insertedRelIds.map(relId => ({ structure_id: structureId, relationship_id: relId }))
      );
    }

    console.log(`[import-xpm-group] Created structure ${structureId} with ${Object.keys(xpmUuidToEntityId).length} entities and ${insertedRelIds.length} relationships`);

    return new Response(JSON.stringify({
      structure_id: structureId,
      entities_count: Object.keys(xpmUuidToEntityId).length,
      relationships_count: insertedRelIds.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[import-xpm-group] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
