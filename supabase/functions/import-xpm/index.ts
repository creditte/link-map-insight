import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Canonical relationship mapping ──────────────────────────────────────
interface CanonicalRule {
  type: string;
  reverse: boolean;
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
  rowNum: number;
  groups: string;
  client: string;
  uuid: string;
  businessStructure: string;
  relationshipType: string;
  relatedClient: string;
}

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, '').trim();
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): RawRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]).map((h) => stripQuotes(h).toLowerCase());
  const idx = {
    groups: header.findIndex((h) => h.includes("group")),
    client: header.findIndex((h) => h === "client" || h.includes("client-client") || h === "[client] client"),
    uuid: header.findIndex((h) => h.includes("uuid")),
    bs: header.findIndex((h) => h.includes("business") || h.includes("structure")),
    rel: header.findIndex((h) => h.includes("relationship")),
    related: header.findIndex((h) => h.includes("related")),
  };
  console.log("CSV header indices:", JSON.stringify(idx), "from headers:", JSON.stringify(header));

  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]).map((c) => stripQuotes(c));
    if (cols.length < 3) continue;
    rows.push({
      rowNum: i + 1,
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
  let rowNum = 1;
  while ((m = recordRe.exec(text)) !== null) {
    const rec = m[1];
    rows.push({
      rowNum: rowNum++,
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
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let relationshipsCreated = 0;
    let relationshipsSkipped = 0;
    let structuresCreated = 0;

    // ── Helper: resolve or create an entity by uuid/name ────────────────
    // Returns the DB id or null on failure. Caches results.
    const entityIdCache = new Map<string, string>(); // cacheKey → db id

    async function resolveEntity(
      name: string,
      xpmUuid: string | null,
      entityType: string,
      rowNum: number,
    ): Promise<string | null> {
      if (!name) return null;

      // Check cache first (by uuid, then by name)
      const cacheKey = xpmUuid || name;
      if (entityIdCache.has(cacheKey)) return entityIdCache.get(cacheKey)!;
      // Also check name cache in case we stored it under uuid previously
      if (xpmUuid && entityIdCache.has(name)) return entityIdCache.get(name)!;

      let existing: { id: string; entity_type: string; xpm_uuid: string | null } | null = null;

      // Look up by xpm_uuid first
      if (xpmUuid) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("xpm_uuid", xpmUuid)
          .maybeSingle();
        existing = data;
      }

      // Fall back to name match
      if (!existing) {
        const { data } = await supabase
          .from("entities")
          .select("id, entity_type, xpm_uuid")
          .eq("tenant_id", tenantId)
          .eq("name", name)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        // Update entity_type / xpm_uuid if we have better info
        const updates: Record<string, string> = {};
        if (entityType !== "Unclassified" && existing.entity_type === "Unclassified") {
          updates.entity_type = entityType;
          updates.source = "imported";
        }
        if (xpmUuid && !existing.xpm_uuid) {
          updates.xpm_uuid = xpmUuid;
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("entities").update(updates).eq("id", existing.id);
          entitiesUpdated++;
        }

        entityIdCache.set(cacheKey, existing.id);
        if (cacheKey !== name) entityIdCache.set(name, existing.id);
        return existing.id;
      }

      // Create new entity
      const { data, error } = await supabase
        .from("entities")
        .insert({
          tenant_id: tenantId,
          name,
          xpm_uuid: xpmUuid,
          entity_type: entityType,
          source: "imported",
        })
        .select("id")
        .single();

      if (error) {
        warnings.push(`Row ${rowNum}: Failed to create entity "${name}": ${error.message}`);
        return null;
      }

      entityIdCache.set(cacheKey, data.id);
      if (cacheKey !== name) entityIdCache.set(name, data.id);
      entitiesCreated++;
      return data.id;
    }

    // ── 1. First pass: resolve all entities ─────────────────────────────
    for (const row of rows) {
      if (row.client) {
        const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
        await resolveEntity(row.client, row.uuid || null, et, row.rowNum);
      }
      if (row.relatedClient) {
        await resolveEntity(row.relatedClient, null, "Unclassified", row.rowNum);
      }
    }

    // ── 2. Structures from Group(s) ────────────────────────────────────
    const structureIdByName = new Map<string, string>();
    const structureEntityPairs = new Set<string>();

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
              warnings.push(`Row ${row.rowNum}: Failed to create structure "${gn}": ${error.message}`);
              continue;
            }
            structureIdByName.set(gn, data.id);
            structuresCreated++;
          }
        }

        // Link client entity to structure
        const clientId = entityIdCache.get(row.uuid || row.client);
        const structureId = structureIdByName.get(gn);
        if (clientId && structureId) {
          const pairKey = `${structureId}:${clientId}`;
          if (!structureEntityPairs.has(pairKey)) {
            structureEntityPairs.add(pairKey);
            await supabase
              .from("structure_entities")
              .upsert({ structure_id: structureId, entity_id: clientId }, { onConflict: "structure_id,entity_id", ignoreDuplicates: true });
          }
        }

        // Link related entity to structure
        const relatedId = entityIdCache.get(row.relatedClient);
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

    // ── 3. Relationships – iterate EVERY row ───────────────────────────
    const relDedupeSet = new Set<string>();

    for (const row of rows) {
      // Skip rows with no relationship data
      if (!row.relationshipType || !row.client || !row.relatedClient) continue;

      // Normalize relationshipType: strip quotes, trim, lowercase
      const normalizedRelType = row.relationshipType
        .replace(/^"+|"+$/g, '')
        .replace(/""+/g, '"')
        .trim()
        .toLowerCase();
      console.log(`Row ${row.rowNum}: relType="${row.relationshipType}" normalized="${normalizedRelType}" client="${row.client}" related="${row.relatedClient}"`);
      const rule = RELATIONSHIP_MAP[normalizedRelType];
      if (!rule) {
        warnings.push(`Row ${row.rowNum}: Unknown relationship type "${row.relationshipType}"`);
        relationshipsSkipped++;
        continue;
      }

      // Resolve entities (will create if missing)
      const clientKey = row.uuid || row.client;
      let fromId = entityIdCache.get(clientKey);
      let toId = entityIdCache.get(row.relatedClient);

      // If still missing, try to create on-the-fly
      if (!fromId) {
        const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
        fromId = await resolveEntity(row.client, row.uuid || null, et, row.rowNum) ?? undefined;
      }
      if (!toId) {
        toId = await resolveEntity(row.relatedClient, null, "Unclassified", row.rowNum) ?? undefined;
      }

      if (!fromId || !toId) {
        warnings.push(`Row ${row.rowNum}: Could not resolve entities for "${row.client}" → "${row.relatedClient}"`);
        relationshipsSkipped++;
        continue;
      }

      // Apply direction rule
      if (rule.reverse) {
        [fromId, toId] = [toId, fromId];
      }

      // For symmetric relationships, order alphabetically to dedupe
      if (rule.type === "spouse" || rule.type === "partner") {
        if (fromId > toId) [fromId, toId] = [toId, fromId];
      }

      const dedupeKey = `${rule.type}:${fromId}:${toId}`;
      if (relDedupeSet.has(dedupeKey)) {
        // Already processed this exact relationship in this import
        continue;
      }
      relDedupeSet.add(dedupeKey);

      // Check if relationship already exists in DB
      const { data: existingRel } = await supabase
        .from("relationships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("from_entity_id", fromId)
        .eq("to_entity_id", toId)
        .eq("relationship_type", rule.type)
        .maybeSingle();

      if (existingRel) {
        // Already exists in DB, skip creation but still link to structures
        await linkRelToStructures(existingRel.id, row);
        continue;
      }

      // Insert new relationship
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
        warnings.push(`Row ${row.rowNum}: Failed to create relationship ${rule.type} "${row.client}" → "${row.relatedClient}": ${relErr.message}`);
        relationshipsSkipped++;
        continue;
      }

      relationshipsCreated++;

      // Link to structures from this row's groups
      await linkRelToStructures(relData.id, row);
    }

    // Helper: link a relationship to all structures from a row's groups
    async function linkRelToStructures(relationshipId: string, row: RawRow) {
      if (!row.groups) return;
      const groupNames = row.groups.split(";").map((g) => g.trim()).filter(Boolean);
      for (const gn of groupNames) {
        const structureId = structureIdByName.get(gn);
        if (structureId) {
          await supabase
            .from("structure_relationships")
            .upsert(
              { structure_id: structureId, relationship_id: relationshipId },
              { onConflict: "structure_id,relationship_id", ignoreDuplicates: true }
            );
        }
      }
    }

    // ── 4. Import log ──────────────────────────────────────────────────
    const result = {
      entitiesCreated,
      entitiesUpdated,
      relationshipsCreated,
      relationshipsSkipped,
      structuresCreated,
      totalRowsParsed: rows.length,
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
