import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How many rows a single execution processes per phase before it persists
// progress and hands off to a fresh worker. Keeps every invocation well
// inside the Edge Function CPU / wall-clock budget.
const ROWS_PER_RUN = Number(Deno.env.get("XPM_IMPORT_ROWS_PER_RUN") ?? "250");
const MAX_WARNINGS = 200;

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
  "appointor of":     { type: "appointer",     reverse: false },
  "appointor":        { type: "appointer",     reverse: true  },
  "settlor of":       { type: "settlor",       reverse: false },
  "settlor":          { type: "settlor",       reverse: true  },
  "partner of":       { type: "partner",       reverse: false },
  "partner":          { type: "partner",       reverse: false },
  "spouse":           { type: "spouse",        reverse: false },
  "parent of":        { type: "parent",        reverse: false },
  "parent":           { type: "parent",        reverse: true  },
  "child of":         { type: "child",         reverse: false },
  "child":            { type: "child",         reverse: true  },
  "member of":        { type: "member",        reverse: false },
  "member":           { type: "member",        reverse: true  },
};

// Flat entity_type mapping from business structure strings
const ENTITY_TYPE_MAP: Record<string, string> = {
  individual: "Individual",
  company: "Company",
  partnership: "Partnership",
  "sole trader": "Sole Trader",
  "incorporated association/club": "Incorporated Association/Club",
  // Trust types - map directly to flat entity_type values
  "discretionary trust": "trust_discretionary",
  "unit trust": "trust_unit",
  "hybrid trust": "trust_hybrid",
  "bare trust": "trust_bare",
  "testamentary trust": "trust_testamentary",
  "deceased estate": "trust_deceased_estate",
  "family trust": "trust_family",
  "self managed superannuation fund": "smsf",
  smsf: "smsf",
  // Generic trust → Unclassified (needs manual review)
  trust: "Unclassified",
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

// ── Job progress shape ──────────────────────────────────────────────────

type Phase = "entities" | "structures" | "relationships" | "done";

interface Progress {
  phase: Phase;
  rowIndex: number;
  totalRowsParsed: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  structuresCreated: number;
  runs: number;
  warnings: string[];
}

function emptyProgress(total: number): Progress {
  return {
    phase: "entities",
    rowIndex: 0,
    totalRowsParsed: total,
    entitiesCreated: 0,
    entitiesUpdated: 0,
    relationshipsCreated: 0,
    relationshipsSkipped: 0,
    structuresCreated: 0,
    runs: 0,
    warnings: [],
  };
}

// ── One bounded slice of work ───────────────────────────────────────────

async function runSlice(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  logId: string,
  fileName: string,
  content: string,
  progressIn: Progress,
): Promise<Progress> {
  const isXml = fileName.toLowerCase().endsWith(".xml");
  const rows = isXml ? parseXML(content) : parseCSV(content);
  const p: Progress = { ...progressIn, warnings: [...progressIn.warnings] };
  p.runs += 1;

  const warn = (msg: string) => {
    if (p.warnings.length < MAX_WARNINGS) p.warnings.push(msg);
  };

  const entityIdCache = new Map<string, string>();
  const structureIdByName = new Map<string, string>();

  async function resolveEntity(
    name: string,
    xpmUuid: string | null,
    entityType: string,
    rowNum: number,
  ): Promise<string | null> {
    if (!name) return null;

    const cacheKey = xpmUuid || name;
    if (entityIdCache.has(cacheKey)) return entityIdCache.get(cacheKey)!;
    if (xpmUuid && entityIdCache.has(name)) return entityIdCache.get(name)!;

    let existing: { id: string; entity_type: string; xpm_uuid: string | null } | null = null;

    if (xpmUuid) {
      const { data } = await supabase
        .from("entities")
        .select("id, entity_type, xpm_uuid")
        .eq("tenant_id", tenantId)
        .eq("xpm_uuid", xpmUuid)
        .maybeSingle();
      existing = data as typeof existing;
    }

    if (!existing) {
      const { data } = await supabase
        .from("entities")
        .select("id, entity_type, xpm_uuid")
        .eq("tenant_id", tenantId)
        .eq("name", name)
        .maybeSingle();
      existing = data as typeof existing;
    }

    if (existing) {
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
        p.entitiesUpdated++;
      }

      entityIdCache.set(cacheKey, existing.id);
      if (cacheKey !== name) entityIdCache.set(name, existing.id);
      return existing.id;
    }

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
      warn(`Row ${rowNum}: Failed to create entity "${name}": ${error.message}`);
      return null;
    }

    entityIdCache.set(cacheKey, data.id as string);
    if (cacheKey !== name) entityIdCache.set(name, data.id as string);
    p.entitiesCreated++;
    return data.id as string;
  }

  async function resolveStructure(name: string, rowNum: number): Promise<string | null> {
    if (structureIdByName.has(name)) return structureIdByName.get(name)!;
    const { data: existing } = await supabase
      .from("structures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", name)
      .maybeSingle();
    if (existing) {
      structureIdByName.set(name, existing.id as string);
      return existing.id as string;
    }
    const { data, error } = await supabase
      .from("structures")
      .insert({ tenant_id: tenantId, name })
      .select("id")
      .single();
    if (error) {
      warn(`Row ${rowNum}: Failed to create structure "${name}": ${error.message}`);
      return null;
    }
    structureIdByName.set(name, data.id as string);
    p.structuresCreated++;
    return data.id as string;
  }

  async function linkRelToStructures(relationshipId: string, row: RawRow) {
    if (!row.groups) return;
    const groupNames = row.groups.split(";").map((g) => g.trim()).filter(Boolean);
    for (const gn of groupNames) {
      const structureId = await resolveStructure(gn, row.rowNum);
      if (!structureId) continue;
      await supabase
        .from("structure_relationships")
        .upsert(
          { structure_id: structureId, relationship_id: relationshipId },
          { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
        );
    }
  }

  const end = Math.min(rows.length, p.rowIndex + ROWS_PER_RUN);

  // ── Phase 1: entities ────────────────────────────────────────────────
  if (p.phase === "entities") {
    for (let i = p.rowIndex; i < end; i++) {
      const row = rows[i];
      if (row.client) {
        const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
        await resolveEntity(row.client, row.uuid || null, et, row.rowNum);
      }
      if (row.relatedClient) {
        await resolveEntity(row.relatedClient, null, "Unclassified", row.rowNum);
      }
    }
    p.rowIndex = end;
    if (p.rowIndex >= rows.length) {
      p.phase = "structures";
      p.rowIndex = 0;
    }
    return p;
  }

  // ── Phase 2: structures + membership ─────────────────────────────────
  if (p.phase === "structures") {
    for (let i = p.rowIndex; i < end; i++) {
      const row = rows[i];
      if (!row.groups) continue;
      const groupNames = row.groups.split(";").map((g) => g.trim()).filter(Boolean);
      for (const gn of groupNames) {
        const structureId = await resolveStructure(gn, row.rowNum);
        if (!structureId) continue;

        const memberIds: string[] = [];
        if (row.client) {
          const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
          const id = await resolveEntity(row.client, row.uuid || null, et, row.rowNum);
          if (id) memberIds.push(id);
        }
        if (row.relatedClient) {
          const id = await resolveEntity(row.relatedClient, null, "Unclassified", row.rowNum);
          if (id) memberIds.push(id);
        }
        if (memberIds.length > 0) {
          await supabase
            .from("structure_entities")
            .upsert(
              memberIds.map((entity_id) => ({ structure_id: structureId, entity_id })),
              { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
            );
        }
      }
    }
    p.rowIndex = end;
    if (p.rowIndex >= rows.length) {
      p.phase = "relationships";
      p.rowIndex = 0;
    }
    return p;
  }

  // ── Phase 3: relationships ───────────────────────────────────────────
  for (let i = p.rowIndex; i < end; i++) {
    const row = rows[i];
    if (!row.relationshipType || !row.client || !row.relatedClient) continue;

    const normalizedRelType = row.relationshipType
      .replace(/^"+|"+$/g, '')
      .replace(/""+/g, '"')
      .trim()
      .toLowerCase();
    const rule = RELATIONSHIP_MAP[normalizedRelType];
    if (!rule) {
      warn(`Row ${row.rowNum}: Unknown relationship type "${row.relationshipType}"`);
      p.relationshipsSkipped++;
      continue;
    }

    const et = ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified";
    let fromId = (await resolveEntity(row.client, row.uuid || null, et, row.rowNum)) ?? undefined;
    let toId = (await resolveEntity(row.relatedClient, null, "Unclassified", row.rowNum)) ?? undefined;

    if (!fromId || !toId) {
      warn(`Row ${row.rowNum}: Could not resolve entities for "${row.client}" → "${row.relatedClient}"`);
      p.relationshipsSkipped++;
      continue;
    }

    if (rule.reverse) {
      [fromId, toId] = [toId, fromId];
    }

    if (rule.type === "spouse" || rule.type === "partner") {
      if (fromId > toId) [fromId, toId] = [toId, fromId];
    }

    // Enforce Individual → SMSF direction for member relationships
    if (rule.type === "member") {
      const { data: fromEnt } = await supabase.from("entities").select("entity_type").eq("id", fromId).single();
      const { data: toEnt } = await supabase.from("entities").select("entity_type").eq("id", toId).single();
      if (fromEnt?.entity_type === "smsf" && toEnt?.entity_type === "Individual") {
        [fromId, toId] = [toId, fromId];
      }
    }

    const { data: existingRel } = await supabase
      .from("relationships")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("from_entity_id", fromId)
      .eq("to_entity_id", toId)
      .eq("relationship_type", rule.type)
      .maybeSingle();

    if (existingRel) {
      await linkRelToStructures(existingRel.id as string, row);
      continue;
    }

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
      warn(`Row ${row.rowNum}: Failed to create relationship ${rule.type} "${row.client}" → "${row.relatedClient}": ${relErr.message}`);
      p.relationshipsSkipped++;
      continue;
    }

    p.relationshipsCreated++;
    await linkRelToStructures(relData.id as string, row);

    // Auto-set is_trustee_company for companies acting as trustee for a trust
    if (rule.type === "trustee") {
      const { data: trusteeEnt } = await supabase
        .from("entities")
        .select("entity_type, is_trustee_company")
        .eq("id", fromId)
        .single();
      if (trusteeEnt && trusteeEnt.entity_type === "Company" && !trusteeEnt.is_trustee_company) {
        await supabase.from("entities").update({ is_trustee_company: true }).eq("id", fromId);
      }
    }
  }

  p.rowIndex = end;
  if (p.rowIndex >= rows.length) {
    p.phase = "done";
  }
  return p;
}

// ── Background driver: one slice, persist, hand off to a fresh worker ──

async function processJob(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  logId: string,
) {
  const { data: log } = await supabase
    .from("import_logs")
    .select("id, tenant_id, file_name, raw_payload, result, status")
    .eq("id", logId)
    .maybeSingle();

  if (!log || log.status !== "processing") return;

  const fileName = (log.file_name as string) ?? "import.csv";
  const content = (log.raw_payload as string) ?? "";
  const progress = (log.result as Progress | null) ?? emptyProgress(0);

  try {
    const next = await runSlice(
      supabase,
      log.tenant_id as string,
      logId,
      fileName,
      content,
      progress,
    );

    const done = next.phase === "done";
    await supabase
      .from("import_logs")
      .update({ status: done ? "completed" : "processing", result: next })
      .eq("id", logId);

    if (!done) {
      // Chain a fresh worker so no single execution can exhaust its budget.
      await fetch(`${supabaseUrl}/functions/v1/import-xpm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ jobId: logId, __continue: true }),
      });
    }
  } catch (err) {
    console.error("import-xpm slice failed:", err);
    await supabase
      .from("import_logs")
      .update({
        status: "failed",
        result: {
          ...progress,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .eq("id", logId);
  }
}

// ── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const body = await req.json().catch(() => ({}));

    // ── Internal continuation call ──────────────────────────────────────
    if (body?.__continue && body?.jobId) {
      if (authHeader !== `Bearer ${serviceKey}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const jobId = body.jobId as string;
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      const task = processJob(supabase, supabaseUrl, serviceKey, jobId);
      if (runtime?.waitUntil) runtime.waitUntil(task); else await task;
      return new Response(JSON.stringify({ status: "processing", jobId }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── User-initiated import ───────────────────────────────────────────
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

    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileName, content } = body ?? {};
    if (!content || !fileName) {
      return new Response(JSON.stringify({ error: "Missing fileName or content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isXml = String(fileName).toLowerCase().endsWith(".xml");
    const rows = isXml ? parseXML(content) : parseCSV(content);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No records found in file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: log, error: logErr } = await supabase
      .from("import_logs")
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        file_name: fileName,
        raw_payload: content,
        status: "processing",
        result: emptyProgress(rows.length),
      })
      .select("id")
      .single();

    if (logErr || !log) {
      return new Response(JSON.stringify({ error: logErr?.message ?? "Failed to start import" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    const task = processJob(supabase, supabaseUrl, serviceKey, log.id as string);
    if (runtime?.waitUntil) runtime.waitUntil(task); else await task;

    return new Response(
      JSON.stringify({ status: "processing", jobId: log.id, totalRowsParsed: rows.length }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("import-xpm error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
