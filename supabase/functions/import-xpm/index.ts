import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How many source rows a single execution processes before it persists progress
// and hands off to a fresh worker. Every row is now handled in ONE pass with
// batched DB statements, so a slice can be far larger than the old row-by-row
// implementation allowed while staying inside the CPU / wall-clock budget.
const ROWS_PER_RUN = Number(Deno.env.get("XPM_IMPORT_ROWS_PER_RUN") ?? "1500");
/** Rows per bulk INSERT / UPSERT statement. */
const DB_BATCH_SIZE = Number(Deno.env.get("XPM_IMPORT_DB_BATCH_SIZE") ?? "500");
/**
 * Max values per `.in(...)` filter. These live in the request URL, so large
 * batches produce multi-kilobyte URLs that PostgREST/HTTP2 rejects with an
 * "unspecific protocol error". Keep well under the URL limit.
 */
const FILTER_BATCH_SIZE = Number(Deno.env.get("XPM_IMPORT_FILTER_BATCH_SIZE") ?? "80");
/** Max independent DB statements in flight at once. */
const DB_CONCURRENCY = Number(Deno.env.get("XPM_IMPORT_DB_CONCURRENCY") ?? "4");
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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


/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
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
 * Parse ONLY the requested window of data rows. Earlier implementations parsed
 * every row of the file on every slice (O(n²) field parsing for large files);
 * splitting lines is cheap, so we skip straight to the window we need.
 */
function parseCSVRange(text: string, start: number, count: number): { rows: RawRow[]; total: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], total: 0 };

  const header = parseCSVLine(lines[0]).map((h) => stripQuotes(h).toLowerCase());
  const idx = {
    groups: header.findIndex((h) => h.includes("group")),
    client: header.findIndex((h) => h === "client" || h.includes("client-client") || h === "[client] client"),
    uuid: header.findIndex((h) => h.includes("uuid")),
    bs: header.findIndex((h) => h.includes("business") || h.includes("structure")),
    rel: header.findIndex((h) => h.includes("relationship")),
    related: header.findIndex((h) => h.includes("related")),
  };

  const total = lines.length - 1;
  const from = 1 + Math.max(0, start);
  const to = Math.min(lines.length, from + Math.max(0, count));

  const rows: RawRow[] = [];
  for (let i = from; i < to; i++) {
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
  return { rows, total };
}

function getTagText(record: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = record.match(re);
  return m ? m[1].trim() : "";
}

/** XML equivalent of parseCSVRange — records before the window are skipped. */
function parseXMLRange(text: string, start: number, count: number): { rows: RawRow[]; total: number } {
  const rows: RawRow[] = [];
  const recordRe = /<Record>([\s\S]*?)<\/Record>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  const end = start + count;
  while ((m = recordRe.exec(text)) !== null) {
    const i = index++;
    if (i < start || i >= end) continue;
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
  return { rows, total: index };
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
    runs: 0,
    warnings: [],
  };
}

// ── One bounded slice of work, fully batched ────────────────────────────

interface EntityRec {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
  is_trustee_company: boolean;
}

async function runSlice(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  fileName: string,
  content: string,
  progressIn: Progress,
): Promise<Progress> {
  const isXml = fileName.toLowerCase().endsWith(".xml");
  const p: Progress = { ...progressIn, warnings: [...progressIn.warnings] };
  p.runs += 1;

  const parsed = isXml
    ? parseXMLRange(content, p.rowIndex, ROWS_PER_RUN)
    : parseCSVRange(content, p.rowIndex, ROWS_PER_RUN);
  const rows = parsed.rows;
  p.totalRowsParsed = parsed.total;

  const warn = (msg: string) => {
    if (p.warnings.length < MAX_WARNINGS) p.warnings.push(msg);
  };

  const end = Math.min(parsed.total, p.rowIndex + ROWS_PER_RUN);


  // ── Pass 1: in-memory collection (no DB calls) ─────────────────────────
  // Distinct client names with their best-known type/uuid, distinct related
  // names, and distinct group names for this slice only.
  const wanted = new Map<string, { name: string; uuid: string | null; entityType: string }>();
  const groupNames = new Set<string>();

  const noteEntity = (name: string, uuid: string | null, entityType: string) => {
    const prev = wanted.get(name);
    if (!prev) {
      wanted.set(name, { name, uuid, entityType });
      return;
    }
    if (!prev.uuid && uuid) prev.uuid = uuid;
    if (prev.entityType === "Unclassified" && entityType !== "Unclassified") prev.entityType = entityType;
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

  // ── Pass 2: batch-resolve structures ──────────────────────────────────
  const structureIdByName = new Map<string, string>();
  const groupList = [...groupNames];
  if (groupList.length > 0) {
    await mapLimit(chunk(groupList, FILTER_BATCH_SIZE), LOOKUP_CONCURRENCY, async (names) => {
      const { data, error } = await withRetry("structure lookup", () =>
        supabase
          .from("structures")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("name", names));
      if (error) throw new Error(`Structure lookup failed: ${error.message}`);
      for (const s of data ?? []) structureIdByName.set(s.name as string, s.id as string);
    });


    const missingStructures = groupList.filter((n) => !structureIdByName.has(n));
    for (const batch of chunk(missingStructures, DB_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("structures")
        .insert(batch.map((name) => ({ tenant_id: tenantId, name })))
        .select("id, name");
      if (error) {
        // Fall back per-row so one rejected structure (e.g. diagram limit)
        // doesn't abort the whole import.
        for (const name of batch) {
          const { data: one, error: e1 } = await supabase
            .from("structures")
            .insert({ tenant_id: tenantId, name })
            .select("id, name")
            .single();
          if (e1 || !one) {
            warn(`Failed to create structure "${name}": ${e1?.message ?? "unknown error"}`);
            continue;
          }
          structureIdByName.set(one.name as string, one.id as string);
          p.structuresCreated++;
        }
        continue;
      }
      for (const s of data ?? []) {
        structureIdByName.set(s.name as string, s.id as string);
        p.structuresCreated++;
      }
    }
  }

  // ── Pass 3: batch-resolve entities ────────────────────────────────────
  const byName = new Map<string, EntityRec>();
  const byUuid = new Map<string, EntityRec>();
  const cols = "id, name, entity_type, xpm_uuid, is_trustee_company";

  const uuids = [...wanted.values()].map((w) => w.uuid).filter((u): u is string => !!u);
  const names = [...wanted.keys()];

  // UUID and name lookups are independent of each other, and each chunk is an
  // independent query — run them all with bounded concurrency instead of
  // waiting for one round trip at a time.
  const uuidHits: EntityRec[] = [];
  const nameHits: EntityRec[] = [];

  await Promise.all([
    mapLimit(chunk(uuids, FILTER_BATCH_SIZE), LOOKUP_CONCURRENCY, async (batch) => {
      const { data, error } = await withRetry("entity uuid lookup", () =>
        supabase
          .from("entities")
          .select(cols)
          .eq("tenant_id", tenantId)
          .in("xpm_uuid", batch));
      if (error) throw new Error(`Entity uuid lookup failed: ${error.message}`);
      uuidHits.push(...((data ?? []) as unknown as EntityRec[]));
    }),
    mapLimit(chunk(names, FILTER_BATCH_SIZE), LOOKUP_CONCURRENCY, async (batch) => {
      const { data, error } = await withRetry("entity name lookup", () =>
        supabase
          .from("entities")
          .select(cols)
          .eq("tenant_id", tenantId)
          .in("name", batch));
      if (error) throw new Error(`Entity name lookup failed: ${error.message}`);
      nameHits.push(...((data ?? []) as unknown as EntityRec[]));
    }),
  ]);

  // UUID matches win over name matches, exactly as before.
  for (const e of uuidHits) {
    if (e.xpm_uuid) byUuid.set(e.xpm_uuid, e);
    if (!byName.has(e.name)) byName.set(e.name, e);
  }
  for (const e of nameHits) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }


  /** Existing record for a wanted entity, matched by uuid first then name. */
  const findExisting = (w: { name: string; uuid: string | null }): EntityRec | undefined =>
    (w.uuid ? byUuid.get(w.uuid) : undefined) ?? byName.get(w.name);

  // Backfill / upgrade existing records in bulk (id-conflict upsert).
  const entityUpdates: Record<string, unknown>[] = [];
  const toInsert: { name: string; uuid: string | null; entityType: string }[] = [];
  for (const w of wanted.values()) {
    const existing = findExisting(w);
    if (!existing) {
      toInsert.push(w);
      continue;
    }
    const needsType = w.entityType !== "Unclassified" && existing.entity_type === "Unclassified";
    const needsUuid = !!w.uuid && !existing.xpm_uuid;
    if (needsType || needsUuid) {
      if (needsType) existing.entity_type = w.entityType;
      if (needsUuid) existing.xpm_uuid = w.uuid;
      entityUpdates.push({
        id: existing.id,
        tenant_id: tenantId,
        name: existing.name,
        entity_type: existing.entity_type,
        xpm_uuid: existing.xpm_uuid,
        source: "imported",
      });
    }
  }

  await mapLimit(chunk(entityUpdates, DB_BATCH_SIZE), DB_CONCURRENCY, async (batch) => {
    const { error } = await supabase.from("entities").upsert(batch, { onConflict: "id" });
    if (error) {
      warn(`Failed to update ${batch.length} existing entities: ${error.message}`);
      return;
    }
    p.entitiesUpdated += batch.length;
  });

  for (const batch of chunk(toInsert, DB_BATCH_SIZE)) {
    const payload = batch.map((w) => ({
      tenant_id: tenantId,
      name: w.name,
      xpm_uuid: w.uuid,
      entity_type: w.entityType,
      source: "imported",
    }));
    const { data, error } = await supabase.from("entities").insert(payload).select(cols);
    if (error) {
      for (const w of batch) {
        const { data: one, error: e1 } = await supabase
          .from("entities")
          .insert({ tenant_id: tenantId, name: w.name, xpm_uuid: w.uuid, entity_type: w.entityType, source: "imported" })
          .select(cols)
          .single();
        if (e1 || !one) {
          warn(`Failed to create entity "${w.name}": ${e1?.message ?? "unknown error"}`);
          continue;
        }
        const rec = one as unknown as EntityRec;
        byName.set(rec.name, rec);
        if (rec.xpm_uuid) byUuid.set(rec.xpm_uuid, rec);
        p.entitiesCreated++;
      }
      continue;
    }
    for (const rec of (data ?? []) as unknown as EntityRec[]) {
      byName.set(rec.name, rec);
      if (rec.xpm_uuid) byUuid.set(rec.xpm_uuid, rec);
      p.entitiesCreated++;
    }
  }

  const entityIdFor = (name: string, uuid: string | null): EntityRec | undefined =>
    (uuid ? byUuid.get(uuid) : undefined) ?? byName.get(name);

  // ── Pass 4: structure membership (bulk upsert, deduped in memory) ──────
  const memberKeys = new Set<string>();
  const memberRows: { structure_id: string; entity_id: string }[] = [];
  rows.forEach((row, i) => {
    const gs = rowGroups[i];
    if (gs.length === 0) return;
    const ids: string[] = [];
    if (row.client) {
      const e = entityIdFor(row.client, row.uuid || null);
      if (e) ids.push(e.id);
    }
    if (row.relatedClient) {
      const e = entityIdFor(row.relatedClient, null);
      if (e) ids.push(e.id);
    }
    for (const gn of gs) {
      const sid = structureIdByName.get(gn);
      if (!sid) continue;
      for (const entity_id of ids) {
        const key = `${sid}|${entity_id}`;
        if (memberKeys.has(key)) continue;
        memberKeys.add(key);
        memberRows.push({ structure_id: sid, entity_id });
      }
    }
  });

  await mapLimit(chunk(memberRows, DB_BATCH_SIZE), DB_CONCURRENCY, async (batch) => {
    const { error } = await supabase
      .from("structure_entities")
      .upsert(batch, { onConflict: "structure_id,entity_id", ignoreDuplicates: true });
    if (error) warn(`Failed to link ${batch.length} entities to structures: ${error.message}`);
  });

  // ── Pass 5: relationships ─────────────────────────────────────────────
  interface RelCandidate {
    from: string;
    to: string;
    type: string;
    structureIds: string[];
    rowNum: number;
    label: string;
  }

  const relByKey = new Map<string, RelCandidate>();
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

    const fromEnt = entityIdFor(row.client, row.uuid || null);
    const toEnt = entityIdFor(row.relatedClient, null);
    if (!fromEnt || !toEnt) {
      warn(`Row ${row.rowNum}: Could not resolve entities for "${row.client}" → "${row.relatedClient}"`);
      p.relationshipsSkipped++;
      return;
    }

    let a = fromEnt;
    let b = toEnt;
    if (rule.reverse) [a, b] = [b, a];
    if (rule.type === "spouse" || rule.type === "partner") {
      if (a.id > b.id) [a, b] = [b, a];
    }
    // Enforce Individual → SMSF direction for member relationships (resolved
    // from the in-memory entity map instead of two extra queries per row).
    if (rule.type === "member" && a.entity_type === "smsf" && b.entity_type === "Individual") {
      [a, b] = [b, a];
    }

    const key = `${a.id}|${b.id}|${rule.type}`;
    const sids = rowGroups[i].map((gn) => structureIdByName.get(gn)).filter((s): s is string => !!s);
    const existingCandidate = relByKey.get(key);
    if (existingCandidate) {
      for (const s of sids) if (!existingCandidate.structureIds.includes(s)) existingCandidate.structureIds.push(s);
      return;
    }
    relByKey.set(key, {
      from: a.id,
      to: b.id,
      type: rule.type,
      structureIds: sids,
      rowNum: row.rowNum,
      label: `${rule.type} "${row.client}" → "${row.relatedClient}"`,
    });
  });

  const candidates = [...relByKey.values()];
  const relIdByKey = new Map<string, string>();

  if (candidates.length > 0) {
    // One batched superset lookup instead of a query per candidate.
    const fromIds = [...new Set(candidates.map((c) => c.from))];
    await mapLimit(chunk(fromIds, FILTER_BATCH_SIZE), LOOKUP_CONCURRENCY, async (batch) => {
      const { data, error } = await withRetry("relationship lookup", () =>
        supabase
          .from("relationships")
          .select("id, from_entity_id, to_entity_id, relationship_type")
          .eq("tenant_id", tenantId)
          .in("from_entity_id", batch));
      if (error) throw new Error(`Relationship lookup failed: ${error.message}`);
      for (const r of data ?? []) {
        relIdByKey.set(
          `${r.from_entity_id}|${r.to_entity_id}|${r.relationship_type}`,
          r.id as string,
        );
      }
    });


    const missing = candidates.filter((c) => !relIdByKey.has(`${c.from}|${c.to}|${c.type}`));
    for (const batch of chunk(missing, DB_BATCH_SIZE)) {
      const payload = batch.map((c) => ({
        tenant_id: tenantId,
        from_entity_id: c.from,
        to_entity_id: c.to,
        relationship_type: c.type,
        source: "imported",
        confidence: "imported",
      }));
      const { data, error } = await supabase
        .from("relationships")
        .insert(payload)
        .select("id, from_entity_id, to_entity_id, relationship_type");
      if (error) {
        // Validation triggers reject individual edges; isolate them so the
        // rest of the batch still lands and each bad row gets its warning.
        for (const c of batch) {
          const { data: one, error: e1 } = await supabase
            .from("relationships")
            .insert({
              tenant_id: tenantId,
              from_entity_id: c.from,
              to_entity_id: c.to,
              relationship_type: c.type,
              source: "imported",
              confidence: "imported",
            })
            .select("id")
            .single();
          if (e1 || !one) {
            warn(`Row ${c.rowNum}: Failed to create relationship ${c.label}: ${e1?.message ?? "unknown error"}`);
            p.relationshipsSkipped++;
            continue;
          }
          relIdByKey.set(`${c.from}|${c.to}|${c.type}`, one.id as string);
          p.relationshipsCreated++;
        }
        continue;
      }
      for (const r of data ?? []) {
        relIdByKey.set(`${r.from_entity_id}|${r.to_entity_id}|${r.relationship_type}`, r.id as string);
        p.relationshipsCreated++;
      }
    }

    // Structure ↔ relationship membership, bulk + deduped.
    const relLinkKeys = new Set<string>();
    const relLinks: { structure_id: string; relationship_id: string }[] = [];
    for (const c of candidates) {
      const relId = relIdByKey.get(`${c.from}|${c.to}|${c.type}`);
      if (!relId) continue;
      for (const sid of c.structureIds) {
        const key = `${sid}|${relId}`;
        if (relLinkKeys.has(key)) continue;
        relLinkKeys.add(key);
        relLinks.push({ structure_id: sid, relationship_id: relId });
      }
    }
    await mapLimit(chunk(relLinks, DB_BATCH_SIZE), DB_CONCURRENCY, async (batch) => {
      const { error } = await supabase
        .from("structure_relationships")
        .upsert(batch, { onConflict: "structure_id,relationship_id", ignoreDuplicates: true });
      if (error) warn(`Failed to link ${batch.length} relationships to structures: ${error.message}`);
    });

    // Auto-flag corporate trustees — one bulk UPDATE instead of 2 statements
    // per trustee relationship.
    const recById = new Map<string, EntityRec>();
    for (const rec of byName.values()) recById.set(rec.id, rec);
    for (const rec of byUuid.values()) recById.set(rec.id, rec);
    const trusteeIds = [
      ...new Set(
        candidates
          .filter((c) => c.type === "trustee")
          .map((c) => c.from)
          .filter((id) => {
            const rec = recById.get(id);
            return rec?.entity_type === "Company" && !rec.is_trustee_company;
          }),
      ),
    ];

    for (const batch of chunk(trusteeIds, FILTER_BATCH_SIZE)) {
      const { error } = await withRetry("trustee flag update", () =>
        supabase.from("entities").update({ is_trustee_company: true }).in("id", batch));
      if (error) warn(`Failed to flag ${batch.length} trustee companies: ${error.message}`);
    }
  }

  p.rowIndex = end;
  if (p.rowIndex >= parsed.total) p.phase = "done";
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
    const next = await runSlice(supabase, log.tenant_id as string, fileName, content, progress);

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
    // rowIndex is only advanced on success, so a retry resumes at the start of
    // the failed slice; every write in a slice is idempotent (lookup-then-
    // insert / upsert), so nothing is duplicated.
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
