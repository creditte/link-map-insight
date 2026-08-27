import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Rows a single slice hands to the database. Everything a slice does is now a
 * SINGLE `import_xpm_batch` RPC — no per-row HTTP inserts, no `.in(...)`
 * lookup chunking — so a slice can be large. The cap exists only to bound the
 * JSON payload size of one request.
 */
const ROWS_PER_RUN = Number(Deno.env.get("XPM_IMPORT_ROWS_PER_RUN") ?? "2000");

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

// ── Generic helpers ─────────────────────────────────────────────────────

/**
 * Retry a DB call on transient transport failures (HTTP/2 stream errors,
 * connection resets, timeouts). Deterministic errors are re-thrown at once.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      const transient = msg.includes("http2") || msg.includes("sendrequest") ||
        msg.includes("connection") || msg.includes("stream error") ||
        msg.includes("error sending request") || msg.includes("timed out") ||
        msg.includes("timeout") || msg.includes("reset");
      if (!transient || attempt === attempts) break;
      console.warn(`[import-xpm] transient failure in ${label} (attempt ${attempt}), retrying`);
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

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

/**
 * Parse the WHOLE payload exactly once per worker execution. Earlier versions
 * re-split and re-parsed the file for every slice, which made a large file
 * quadratic in field parsing; slices are now taken from this array.
 */
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

/** XML equivalent of parseCSV — also a single pass over the payload. */
function parseXML(text: string): RawRow[] {
  const rows: RawRow[] = [];
  const recordRe = /<Record>([\s\S]*?)<\/Record>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = recordRe.exec(text)) !== null) {
    const i = index++;
    const rec = m[1];
    rows.push({
      rowNum: i + 1,
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

function parseAll(text: string, isXml: boolean): RawRow[] {
  return isXml ? parseXML(text) : parseCSV(text);
}

/**
 * Count rows without materialising them — used at job creation so we never hold
 * a parsed copy of a large file alongside the raw text.
 */
function countRows(text: string, isXml: boolean): number {
  if (isXml) return (text.match(/<Record>/gi) ?? []).length;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return Math.max(0, lines.length - 1);
}


// ── Job progress shape ──────────────────────────────────────────────────

type Phase = "importing" | "done";

interface Progress {
  phase: Phase | string;
  rowIndex: number;
  totalRowsParsed: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  structuresCreated: number;
  /** Groups that could not be created because the plan's structure limit was hit. */
  structuresSkippedLimit: number;
  /** Rows that referenced a group which could not be created due to the limit. */
  rowsSkippedLimit: number;
  structureLimit: number;
  limitReached: boolean;
  runs: number;
  warnings: string[];
}

function emptyProgress(total: number): Progress {
  return {
    phase: "importing",
    rowIndex: 0,
    totalRowsParsed: total,
    entitiesCreated: 0,
    entitiesUpdated: 0,
    relationshipsCreated: 0,
    relationshipsSkipped: 0,
    structuresCreated: 0,
    structuresSkippedLimit: 0,
    rowsSkippedLimit: 0,
    structureLimit: 0,
    limitReached: false,
    runs: 0,
    warnings: [],
  };
}


// ── One bounded slice of work: build payload → ONE RPC ──────────────────

interface BatchResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  structuresCreated: number;
  structuresSkippedLimit: number;
  structureLimit: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  warnings: string[];
  unavailableGroups: string[];
  unresolvedRels: { row: number; label: string }[];
}

async function runSlice(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  allRows: RawRow[],
  progressIn: Progress,
): Promise<Progress> {
  const p: Progress = {
    ...progressIn,
    // Jobs created before these counters existed resume without them.
    structuresSkippedLimit: progressIn.structuresSkippedLimit ?? 0,
    rowsSkippedLimit: progressIn.rowsSkippedLimit ?? 0,
    structureLimit: progressIn.structureLimit ?? 0,
    limitReached: progressIn.limitReached ?? false,
    warnings: [...(progressIn.warnings ?? [])],
  };

  p.runs += 1;
  p.totalRowsParsed = allRows.length;

  const end = Math.min(allRows.length, p.rowIndex + ROWS_PER_RUN);
  const rows = allRows.slice(p.rowIndex, end);

  const warn = (msg: string) => {
    if (p.warnings.length < MAX_WARNINGS) p.warnings.push(msg);
  };

  // ── Build the payload entirely in memory (no DB calls) ────────────────
  const wanted = new Map<string, { name: string; uuid: string | null; entity_type: string }>();
  const groupNames = new Set<string>();

  const noteEntity = (name: string, uuid: string | null, entityType: string) => {
    const prev = wanted.get(name);
    if (!prev) {
      wanted.set(name, { name, uuid, entity_type: entityType });
      return;
    }
    if (!prev.uuid && uuid) prev.uuid = uuid;
    if (prev.entity_type === "Unclassified" && entityType !== "Unclassified") prev.entity_type = entityType;
  };

  const rowGroups: string[][] = rows.map((row) => {
    const gs = row.groups ? row.groups.split(";").map((g) => g.trim()).filter(Boolean) : [];
    for (const g of gs) groupNames.add(g);
    return gs;
  });

  for (const row of rows) {
    if (row.client) {
      noteEntity(row.client, row.uuid || null, ENTITY_TYPE_MAP[row.businessStructure.toLowerCase()] ?? "Unclassified");
    }
    if (row.relatedClient) noteEntity(row.relatedClient, null, "Unclassified");
  }

  // Structure membership pairs (deduped).
  const memberKeys = new Set<string>();
  const members: { grp: string; ent: string }[] = [];
  rows.forEach((row, i) => {
    for (const grp of rowGroups[i]) {
      for (const ent of [row.client, row.relatedClient]) {
        if (!ent) continue;
        const key = `${grp}|${ent}`;
        if (memberKeys.has(key)) continue;
        memberKeys.add(key);
        members.push({ grp, ent });
      }
    }
  });

  // Relationship candidates (deduped by canonical key).
  interface RelPayload {
    row: number;
    type: string;
    from_key: string;
    to_key: string;
    label: string;
    groups: string[];
  }
  const relByKey = new Map<string, RelPayload>();

  rows.forEach((row, i) => {
    if (!row.relationshipType || !row.client || !row.relatedClient) return;

    const normalizedRelType = row.relationshipType
      .replace(/^"+|"+$/g, '')
      .replace(/""+/g, '"')
      .trim()
      .toLowerCase();
    const rule = RELATIONSHIP_MAP[normalizedRelType];
    if (!rule) {
      warn(`Row ${row.rowNum}: Unknown relationship type "${row.relationshipType}"`);
      p.relationshipsSkipped++;
      return;
    }

    let from = row.client;
    let to = row.relatedClient;
    if (rule.reverse) [from, to] = [to, from];

    const key = `${from}|${to}|${rule.type}`;
    const existing = relByKey.get(key);
    if (existing) {
      for (const g of rowGroups[i]) if (!existing.groups.includes(g)) existing.groups.push(g);
      return;
    }
    relByKey.set(key, {
      row: row.rowNum,
      type: rule.type,
      from_key: from,
      to_key: to,
      label: `${rule.type} "${row.client}" → "${row.relatedClient}"`,
      groups: [...rowGroups[i]],
    });
  });

  // ── ONE round trip for the whole slice ───────────────────────────────
  const { data, error } = await withRetry("import_xpm_batch", () =>
    supabase.rpc("import_xpm_batch", {
      _tenant_id: tenantId,
      _payload: {
        entities: [...wanted.values()],
        groups: [...groupNames],
        members,
        rels: [...relByKey.values()],
      },
    }));

  if (error) throw new Error(`Import batch failed: ${error.message}`);
  const res = (data ?? {}) as unknown as BatchResult;

  p.entitiesCreated += res.entitiesCreated ?? 0;
  p.entitiesUpdated += res.entitiesUpdated ?? 0;
  p.structuresCreated += res.structuresCreated ?? 0;
  p.structuresSkippedLimit += res.structuresSkippedLimit ?? 0;
  p.relationshipsCreated += res.relationshipsCreated ?? 0;
  p.relationshipsSkipped += res.relationshipsSkipped ?? 0;
  if (res.structureLimit) p.structureLimit = res.structureLimit;
  if ((res.structuresSkippedLimit ?? 0) > 0) p.limitReached = true;

  for (const w of res.warnings ?? []) warn(String(w));

  // Rows whose grouping was lost because a structure could not be created.
  const unavailable = new Set(res.unavailableGroups ?? []);
  if (unavailable.size > 0) {
    for (const gs of rowGroups) {
      if (gs.some((g) => unavailable.has(g))) p.rowsSkippedLimit++;
    }
  }

  for (const u of res.unresolvedRels ?? []) {
    p.relationshipsSkipped++;
    warn(`Row ${u.row}: Could not resolve entities for ${u.label}`);
  }

  p.rowIndex = end;
  if (p.rowIndex >= allRows.length) p.phase = "done";
  return p;
}

// ── Background driver: slices, persist, hand off to a fresh worker ──────

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
  let current = progress;

  try {
    // Parse the payload ONCE for this execution, then slice from memory.
    const allRows = parseAll(content, fileName.toLowerCase().endsWith(".xml"));

    // Heartbeat before any heavy work, so a worker death is visible as a
    // stalled `updated_at` (and gets reaped) rather than an invisible hang.
    await supabase
      .from("import_logs")
      .update({ status: "processing", result: { ...current, totalRowsParsed: allRows.length } })
      .eq("id", logId);

    const started = Date.now();
    const BUDGET_MS = 45_000;
    let done = false;

    for (;;) {
      current = await runSlice(supabase, log.tenant_id as string, allRows, current);
      done = current.phase === "done";
      await supabase
        .from("import_logs")
        .update({ status: done ? "completed" : "processing", result: current })
        .eq("id", logId);
      if (done || Date.now() - started > BUDGET_MS) break;
    }

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
    // rowIndex is only advanced on success, so a retry resumes at the start of
    // the failed slice; every write in a slice is idempotent (lookup-then-
    // insert / upsert), so nothing is duplicated.
    await supabase
      .from("import_logs")
      .update({
        status: "failed",
        result: {
          ...current,
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

    // Abandoned jobs must not stay "processing" forever.
    await supabase.rpc("fail_stale_import_jobs", { _max_idle_minutes: 10 });

    const { fileName, content } = body ?? {};
    if (!content || !fileName) {
      return new Response(JSON.stringify({ error: "Missing fileName or content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isXml = String(fileName).toLowerCase().endsWith(".xml");
    const totalRows = countRows(content, isXml);
    if (totalRows === 0) {
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
        result: emptyProgress(totalRows),
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
      JSON.stringify({ status: "processing", jobId: log.id, totalRowsParsed: totalRows }),
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
