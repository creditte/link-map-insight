import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Canonical relationship mapping ──────────────────────────────────────
// "X Of" means the Client is X of the RelatedClient  → from=Client, to=RelatedClient
// Plain "X" means the RelatedClient is X of the Client → from=RelatedClient, to=Client
// We normalise so from→to always means "from IS relationship_type OF to"
// e.g. "Director Of" → director, from=client, to=related   (client is director of related)
//      "Director"    → director, from=related, to=client    (related is director of client)

interface CanonicalRule {
  type: string;
  reverse: boolean; // true = swap from/to compared to default (client→related)
}

const RELATIONSHIP_MAP: Record<string, CanonicalRule> = {
  "director of":      { type: "director",      reverse: false },
  "director":         { type: "director",      reverse: true  },
  "shareholder of":   { type: "shareholder",   reverse: false },
  "shareholder":      { type: "shareholder",   reverse: true  },
  "beneficiary of":   { type: "beneficiary",   reverse: false },
  "beneficiary":      { type: "beneficiary",   reverse: true  },
  "trustee of":       { type: "trustee",       reverse: false },
  "trustee":          { type: "trustee",       reverse: true  },
  "appointer of":     { type: "appointer",     reverse: false },
  "appointer":        { type: "appointer",     reverse: true  },
  "settlor of":       { type: "settlor",       reverse: false },
  "settlor":          { type: "settlor",       reverse: true  },
  "partner of":       { type: "partner",       reverse: false },
  "partner":          { type: "partner",       reverse: false },
  "spouse":           { type: "spouse",        reverse: false },
  "parent of":        { type: "parent",        reverse: false },
  "parent":           { type: "parent",        reverse: true  },
  "child of":         { type: "child",         reverse: false },
  "child":            { type: "child",         reverse: true  },
};

const ENTITY_TYPE_MAP: Record<string, string> = {
  individual: "Individual",
  company: "Company",
  trust: "Trust",
  partnership: "Partnership",
  "sole trader": "Sole Trader",
  "incorporated association/club": "Incorporated Association/Club",
};

// ── Parsing helpers ─────────────────────────────────────────────────────

interface RawRow {
  groups: string;
  client: string;
  uuid: string;
  businessStructure: string;
  relationshipType: string;
  relatedClient: string;
}

function parseCSV(text: string): RawRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Detect header positions
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    groups: header.findIndex((h) => h.includes("group")),
    client: header.findIndex((h) => h === "client" || h.includes("client-client") || h === "client-client"),
    uuid: header.findIndex((h) => h.includes("uuid")),
    bs: header.findIndex((h) => h.includes("business") || h.includes("structure")),
    rel: header.findIndex((h) => h.includes("relationship") && h.includes("type")),
    related: header.findIndex((h) => h.includes("related")),
  };

  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 3) continue;
    rows.push({
      groups: cols[idx.groups] ?? "",
      client: cols[idx.client] ?? "",
      uuid: cols[idx.uuid] ?? "",
      businessStructure: cols[idx.bs] ?? "",
      relationshipType: cols[idx.rel] ?? "",
      relatedClient: cols[idx.related] ?? "",
    });
  }
  return rows;
}

function getTagText(record: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = record.match(re);
  return m ? m[1].trim() : "";
}

function parseXML(text: string): RawRow[] {
  const rows: RawRow[] = [];
  const recordRe = /<Record>([\s\S]*?)<\/Record>/gi;
  let m: RegExpExecArray | null;
  while ((m = recordRe.exec(text)) !== null) {
    const rec = m[1];
    rows.push({
      groups: getTagText(rec, "Client-Groups"),
      client: getTagText(rec, "Client-Client"),
      uuid: getTagText(rec, "Client-UUID"),
      businessStructure: getTagText(rec, "Client-BusinessStructure"),
      relationshipType: getTagText(rec, "ClientRelationship-RelationshipType"),
      relatedClient: getTagText(rec, "ClientRelationship-RelatedClient"),
    });
  }
  return rows;
}

// ── Main handler ────────────────────────────────────────────────────────

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

    const { fileName, content } = await req.json();
    if (!content || !fileName) {
      return new Response(JSON.stringify({ error: "Missing fileName or content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse
    const isXml = fileName.toLowerCase().endsWith(".xml");
    const rows = isXml ? parseXML(content) : parseCSV(content);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No records found in file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const warnings: string[] = [];

    // ── 1. Collect unique entities ──────────────────────────────────────
    // key = xpm_uuid or name (for related clients without uuid)
    interface EntityInfo {
      name: string;
      xpm_uuid: string | null;
      entity_type: string;
    }
    const entityMap = new Map<string, EntityInfo>();

    for (const row of rows) {
      // Client entity (has UUID)
      if (row.client) {
        const key = row.uuid || row.client;
        if (!entityMap.has(key)) {
          const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
          entityMap.set(key, {
            name: row.client,
            xpm_uuid: row.uuid || null,
            entity_type: et,
          });
        }
      }
      // Related entity (no UUID from this row)
      if (row.relatedClient && !entityMap.has(row.relatedClient)) {
        entityMap.set(row.relatedClient, {
          name: row.relatedClient,
          xpm_uuid: null,
          entity_type: "Unclassified",
        });
      }
    }

    // ── 2. Upsert entities ─────────────────────────────────────────────
    // For entities with xpm_uuid, upsert by uuid; otherwise by name+tenant
    const entityIdByKey = new Map<string, string>(); // key → db id
    let entitiesCreated = 0;

    for (const [key, info] of entityMap) {
      let existing: { id: string; entity_type: string } | null = null;

      if (info.xpm_uuid) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", info.xpm_uuid)
          .maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type")
          .eq("tenant_id", tenantId)
          .eq("name", info.name)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        // Update entity_type if we have a better one
        if (info.entity_type !== "Unclassified" && existing.entity_type === "Unclassified") {
          await supabase
            .from("entities")
            .update({ entity_type: info.entity_type, xpm_uuid: info.xpm_uuid, source: "imported" })
            .eq("id", existing.id);
        } else if (info.xpm_uuid && !existing.entity_type) {
          await supabase.from("entities").update({ xpm_uuid: info.xpm_uuid }).eq("id", existing.id);
        }
        entityIdByKey.set(key, existing.id);
      } else {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            tenant_id: tenantId,
            name: info.name,
            xpm_uuid: info.xpm_uuid,
            entity_type: info.entity_type,
            source: "imported",
          })
          .select("id")
          .single();
        if (error) {
          warnings.push(`Failed to create entity "${info.name}": ${error.message}`);
          continue;
        }
        entityIdByKey.set(key, data.id);
        entitiesCreated++;
      }

      // Also map by name so related-client lookups work
      if (key !== info.name) {
        entityIdByKey.set(info.name, entityIdByKey.get(key)!);
      }
    }

    // ── 3. Structures from Group(s) ────────────────────────────────────
    const structureIdByName = new Map<string, string>();
    const structureEntityPairs = new Set<string>();
    let structuresCreated = 0;

    for (const row of rows) {
      if (!row.groups) continue;
      const groupNames = row.groups.split(";").map((g) => g.trim()).filter(Boolean);
      for (const gn of groupNames) {
        if (!structureIdByName.has(gn)) {
          const { data: existing } = await supabase
            .from("structures")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("name", gn)
            .maybeSingle();
          if (existing) {
            structureIdByName.set(gn, existing.id);
          } else {
            const { data, error } = await supabase
              .from("structures")
              .insert({ tenant_id: tenantId, name: gn })
              .select("id")
              .single();
            if (error) {
              warnings.push(`Failed to create structure "${gn}": ${error.message}`);
              continue;
            }
            structureIdByName.set(gn, data.id);
            structuresCreated++;
          }
        }
        // Link client entity to structure
        const clientKey = row.uuid || row.client;
        const entityId = entityIdByKey.get(clientKey);
        const structureId = structureIdByName.get(gn);
        if (entityId && structureId) {
          const pairKey = `${structureId}:${entityId}`;
          if (!structureEntityPairs.has(pairKey)) {
            structureEntityPairs.add(pairKey);
            const { error } = await supabase
              .from("structure_entities")
              .upsert({ structure_id: structureId, entity_id: entityId }, { onConflict: "structure_id,entity_id", ignoreDuplicates: true });
            if (error) warnings.push(`structure_entities link error: ${error.message}`);
          }
        }
        // Link related entity to structure too
        const relatedId = entityIdByKey.get(row.relatedClient);
        if (relatedId && structureId) {
          const pairKey = `${structureId}:${relatedId}`;
          if (!structureEntityPairs.has(pairKey)) {
            structureEntityPairs.add(pairKey);
            await supabase
              .from("structure_entities")
              .upsert({ structure_id: structureId, entity_id: relatedId }, { onConflict: "structure_id,entity_id", ignoreDuplicates: true });
          }
        }
      }
    }

    // ── 4. Relationships ───────────────────────────────────────────────
    const relDedupeSet = new Set<string>();
    let relationshipsCreated = 0;

    for (const row of rows) {
      if (!row.relationshipType || !row.client || !row.relatedClient) continue;

      const rule = RELATIONSHIP_MAP[row.relationshipType.toLowerCase()];
      if (!rule) {
        warnings.push(`Unknown relationship type: "${row.relationshipType}"`);
        continue;
      }

      const clientKey = row.uuid || row.client;
      let fromId = entityIdByKey.get(clientKey);
      let toId = entityIdByKey.get(row.relatedClient);
      if (!fromId || !toId) {
        warnings.push(`Missing entity for relationship: "${row.client}" → "${row.relatedClient}"`);
        continue;
      }

      // Apply direction rule
      if (rule.reverse) {
        [fromId, toId] = [toId, fromId];
      }

      // For symmetric relationships (spouse, partner), order alphabetically to dedupe
      if (rule.type === "spouse" || rule.type === "partner") {
        if (fromId > toId) [fromId, toId] = [toId, fromId];
      }

      const dedupeKey = `${rule.type}:${fromId}:${toId}`;
      if (relDedupeSet.has(dedupeKey)) continue;
      relDedupeSet.add(dedupeKey);

      // Check existing
      const { data: existingRel } = await supabase
        .from("relationships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("from_entity_id", fromId)
        .eq("to_entity_id", toId)
        .eq("relationship_type", rule.type)
        .maybeSingle();

      if (!existingRel) {
        const { data: relData, error: relErr } = await supabase
          .from("relationships")
          .insert({
            tenant_id: tenantId,
            from_entity_id: fromId,
            to_entity_id: toId,
            relationship_type: rule.type,
            source: "imported",
            confidence: "imported",
          })
          .select("id")
          .single();

        if (relErr) {
          warnings.push(`Failed to create relationship ${rule.type}: ${relErr.message}`);
          continue;
        }
        relationshipsCreated++;

        // Link to structures
        if (relData) {
          for (const [, structureId] of structureIdByName) {
            await supabase
              .from("structure_relationships")
              .upsert(
                { structure_id: structureId, relationship_id: relData.id },
                { onConflict: "structure_id,relationship_id", ignoreDuplicates: true }
              );
          }
        }
      }
    }

    // ── 5. Import log ──────────────────────────────────────────────────
    const result = {
      entitiesCreated,
      relationshipsCreated,
      structuresCreated,
      warnings,
    };

    await supabase.from("import_logs").insert({
      tenant_id: tenantId,
      user_id: user.id,
      file_name: fileName,
      raw_payload: content,
      status: "completed",
      result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("import-xpm error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
