import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken } from "../_shared/crypto.ts";
import { parse as parseXml } from "https://deno.land/x/xml@6.0.1/mod.ts";
import { parseXpmRelationshipType, resolveRelationshipEndpoints } from "../_shared/xpm-relationships.ts";

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
      relationships: Array<{ typeRaw: string; relatedUuid: string; relatedName: string; percentage: number | null; shares: number | null }>;
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
          const typeRaw = (xmlText(rel, "Type") || xmlText(rel, "RelationshipType")).trim();
          const rc = rel?.RelatedClient;
          const relUuid = xmlText(rc, "UUID") || xmlText(rel, "RelatedClientUUID");
          const relName = xmlText(rc, "Name") || xmlText(rel, "RelatedClientName");
          const pct = parseFloat(xmlText(rel, "Percentage") || xmlText(rel, "OwnershipPercentage"));
          const shares = parseFloat(xmlText(rel, "NumberOfShares"));

          if (relUuid && typeRaw) {
            rels.push({
              typeRaw,
              relatedUuid: relUuid,
              relatedName: relName,
              percentage: isNaN(pct) ? null : pct,
              shares: isNaN(shares) ? null : shares,
            });
          }
        }

        return { uuid, name, entityType: resolveEntityType(bs), abn: xmlText(c, "TaxNumber") || xmlText(c, "ABN") || null, acn: xmlText(c, "CompanyNumber") || xmlText(c, "ACN") || null, businessStructure: bs, relationships: rels } as ClientData;
      }));
      for (const r of results) if (r) clients.push(r);
    }

    // Reuse existing XPM structure for this group name when re-opening in editor
    const { data: existingStruct } = await supabase
      .from("structures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", groupName)
      .eq("source", "xpm")
      .is("deleted_at", null)
      .maybeSingle();

    let structureId: string;

    if (existingStruct) {
      structureId = existingStruct.id;
      // Clear prior links so re-import reflects latest XPM data
      await supabase.from("structure_relationships").delete().eq("structure_id", structureId);
      await supabase.from("structure_entities").delete().eq("structure_id", structureId);
    } else {
      const { data: structure, error: structErr } = await supabase.from("structures").insert({
        name: groupName,
        tenant_id: tenantId,
        layout_mode: "auto",
        source: "xpm",
      }).select("id").single();

      if (structErr || !structure) {
        return new Response(JSON.stringify({ error: "Failed to create structure", detail: structErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      structureId = structure.id;
    }

    // Upsert entities (keyed by xpm_uuid to avoid duplicates)
    const xpmUuidToEntityId: Record<string, string> = {};

    // Check for existing entities with these xpm_uuids
    // `.in(...)` filters live in the request URL — keep batches small so long
    // UUID lists can't blow the URL limit (HTTP2 protocol error).
    const FILTER_BATCH = 80;
    const uuidList = clients.map((c) => c.uuid).filter(Boolean);
    for (let i = 0; i < uuidList.length; i += FILTER_BATCH) {
      const { data: existingEntities } = await supabase
        .from("entities")
        .select("id, xpm_uuid")
        .eq("tenant_id", tenantId)
        .in("xpm_uuid", uuidList.slice(i, i + FILTER_BATCH));
      for (const e of existingEntities ?? []) {
        if (e.xpm_uuid) xpmUuidToEntityId[e.xpm_uuid] = e.id;
      }
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

    // Create relationships (one at a time — bulk insert fails entirely if any row violates DB rules)
    const memberSet = new Set(clients.map((c) => c.uuid));
    const entityTypes = new Map<string, string>();
    for (const c of clients) {
      const id = xpmUuidToEntityId[c.uuid];
      if (id) entityTypes.set(id, c.entityType);
    }

    // Load entity types for reused entities that may not be in this fetch batch
    const allEntityIds = Object.values(xpmUuidToEntityId);
    if (allEntityIds.length > 0) {
      for (let i = 0; i < allEntityIds.length; i += FILTER_BATCH) {
        const { data: typeRows } = await supabase
          .from("entities")
          .select("id, entity_type")
          .in("id", allEntityIds.slice(i, i + FILTER_BATCH));
        for (const row of typeRows ?? []) {
          entityTypes.set(row.id, row.entity_type);
        }
      }
    }

    const relDedupeSet = new Set<string>();
    const linkedRelIds = new Set<string>();
    let relationshipsCreated = 0;
    let relationshipsLinked = 0;
    let relationshipsSkipped = 0;

    for (const client of clients) {
      const clientEntityId = xpmUuidToEntityId[client.uuid];
      if (!clientEntityId) continue;

      for (const rel of client.relationships) {
        if (!memberSet.has(rel.relatedUuid)) continue;
        const relatedEntityId = xpmUuidToEntityId[rel.relatedUuid];
        if (!relatedEntityId) continue;

        const rule = parseXpmRelationshipType(rel.typeRaw);
        if (!rule) {
          relationshipsSkipped++;
          continue;
        }

        const endpoints = resolveRelationshipEndpoints(
          rule.type,
          clientEntityId,
          relatedEntityId,
          entityTypes,
          rule.reverse,
        );
        if (!endpoints) {
          console.warn(`[import-xpm-group] Skipped invalid direction: ${rel.typeRaw} ${client.uuid} → ${rel.relatedUuid}`);
          relationshipsSkipped++;
          continue;
        }

        const { fromId, toId } = endpoints;
        const dedupeKey = `${rule.type}:${fromId}:${toId}`;
        const reverseKey = `${rule.type}:${toId}:${fromId}`;
        if (relDedupeSet.has(dedupeKey) || relDedupeSet.has(reverseKey)) continue;
        relDedupeSet.add(dedupeKey);

        let relationshipId: string | null = null;

        const { data: existingRel } = await supabase
          .from("relationships")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("from_entity_id", fromId)
          .eq("to_entity_id", toId)
          .eq("relationship_type", rule.type)
          .is("deleted_at", null)
          .maybeSingle();

        if (existingRel) {
          relationshipId = existingRel.id;
        } else {
          const { data: insertedRel, error: relErr } = await supabase
            .from("relationships")
            .insert({
              from_entity_id: fromId,
              to_entity_id: toId,
              relationship_type: rule.type,
              tenant_id: tenantId,
              source: "imported",
              ownership_percent: rel.percentage,
              ownership_units: rel.shares,
            })
            .select("id")
            .single();

          if (relErr || !insertedRel) {
            console.error("[import-xpm-group] Relationship insert error:", relErr?.message, { type: rule.type, fromId, toId });
            relationshipsSkipped++;
            continue;
          }
          relationshipId = insertedRel.id;
          relationshipsCreated++;
        }

        if (!relationshipId || linkedRelIds.has(relationshipId)) continue;

        const { error: linkErr } = await supabase
          .from("structure_relationships")
          .upsert(
            { structure_id: structureId, relationship_id: relationshipId },
            { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
          );

        if (linkErr) {
          console.error("[import-xpm-group] structure_relationships link error:", linkErr.message);
          relationshipsSkipped++;
          continue;
        }

        linkedRelIds.add(relationshipId);
        relationshipsLinked++;
      }
    }

    console.log(`[import-xpm-group] Structure ${structureId}: ${Object.keys(xpmUuidToEntityId).length} entities, ${relationshipsLinked} relationships linked (${relationshipsCreated} new, ${relationshipsSkipped} skipped)`);

    return new Response(JSON.stringify({
      structure_id: structureId,
      entities_count: Object.keys(xpmUuidToEntityId).length,
      relationships_count: relationshipsLinked,
      relationships_created: relationshipsCreated,
      relationships_skipped: relationshipsSkipped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[import-xpm-group] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
