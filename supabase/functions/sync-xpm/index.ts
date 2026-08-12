import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chunk,
  corsHeaders,
  discoverPmTenantId,
  extractTrustName,
  FatalXpmError,
  isCorporateTrustee,
  mapLimit,
  refreshAccessToken,
  REL_TYPE_MAP,
  resolveEntityType,
  tuning,
  xmlArray,
  xmlText,
  xpmGetXml,
} from "./_lib.ts";

/**
 * Chunked, resumable XPM sync.
 *
 * A sync is a job row in `import_logs`. Each execution processes a bounded
 * slice of work (a few XPM client pages OR a batch of client groups), persists
 * progress on the job row, then self-invokes to continue in a fresh worker.
 *
 * Memory discipline:
 * - client XML is parsed one page at a time and dropped immediately;
 * - the group catalogue lives in `xpm_groups`, not in the job row — the job row
 *   only stores a cursor, so it stays a few hundred bytes regardless of whether
 *   the practice has 10 or 10,000 groups.
 *
 * Concurrency is bounded (`mapLimit`) so a large practice never fires hundreds
 * of XPM or DB calls at once.
 */

const JOB_FILE_NAME = "xpm-sync-3.1";

type Phase = "clients" | "groups" | "staff" | "done";

interface Stats {
  clientsFetched: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  groupsFound: number;
  groupsCreated: number;
  groupsProcessed: number;
  trusteesDetected: number;
  staffFetched: number;
  typeCounts: Record<string, number>;
}

interface Progress {
  phase: Phase;
  clientPage: number;
  /** Last processed group `xpm_uuid` — the resume cursor for the group phase. */
  groupCursor: string;
  /** True once the group catalogue has been pulled from XPM into `xpm_groups`. */
  groupsLoaded: boolean;
  runs: number;
  started_at: string;
  updated_at: string;
  stats: Stats;
  warnings: string[];
}

function emptyProgress(): Progress {
  return {
    phase: "clients",
    clientPage: 1,
    groupCursor: "",
    groupsLoaded: false,
    runs: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stats: {
      clientsFetched: 0,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      relationshipsCreated: 0,
      relationshipsSkipped: 0,
      groupsFound: 0,
      groupsCreated: 0,
      groupsProcessed: 0,
      trusteesDetected: 0,
      staffFetched: 0,
      typeCounts: {},
    },
    warnings: [],
  };
}


/** Warnings are capped so the job row can't grow unbounded. */
function warn(p: Progress, msg: string) {
  if (p.warnings.length < 200) p.warnings.push(msg);
}

// ── Bulk entity resolution ─────────────────────────────────────────
interface EntityRow {
  id: string;
  name: string;
  xpm_uuid: string | null;
  entity_type: string;
  abn: string | null;
  acn: string | null;
  is_trustee_company: boolean;
}

/** Look up existing entities by xpm_uuid and by name in bulk. */
async function resolveExisting(
  supabase: any,
  tenantId: string,
  uuids: string[],
  names: string[],
  batchSize: number,
): Promise<{ byUuid: Map<string, EntityRow>; byName: Map<string, EntityRow> }> {
  const byUuid = new Map<string, EntityRow>();
  const byName = new Map<string, EntityRow>();
  const cols = "id, name, xpm_uuid, entity_type, abn, acn, is_trustee_company";

  for (const part of chunk(uuids.filter(Boolean), batchSize)) {
    const { data } = await supabase
      .from("entities")
      .select(cols)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("xpm_uuid", part);
    for (const row of data ?? []) {
      if (row.xpm_uuid) byUuid.set(row.xpm_uuid, row);
      byName.set(row.name, row);
    }
  }

  for (const part of chunk(names.filter(Boolean), batchSize)) {
    const { data } = await supabase
      .from("entities")
      .select(cols)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("name", part);
    for (const row of data ?? []) {
      if (!byName.has(row.name)) byName.set(row.name, row);
      if (row.xpm_uuid && !byUuid.has(row.xpm_uuid)) byUuid.set(row.xpm_uuid, row);
    }
  }

  return { byUuid, byName };
}

async function bulkInsertEntities(
  supabase: any,
  rows: Record<string, unknown>[],
  batchSize: number,
  p: Progress,
): Promise<Map<string, string>> {
  const created = new Map<string, string>(); // key (uuid or name) → id
  for (const part of chunk(rows, batchSize)) {
    const { data, error } = await supabase.from("entities").insert(part).select("id, name, xpm_uuid");
    if (error) {
      // Fall back to per-row so one bad record doesn't drop the batch.
      for (const row of part) {
        const { data: one, error: oneErr } = await supabase
          .from("entities")
          .insert(row)
          .select("id, name, xpm_uuid")
          .single();
        if (oneErr) {
          warn(p, `Failed to create entity "${row.name}": ${oneErr.message}`);
          continue;
        }
        created.set((one.xpm_uuid as string) ?? one.name, one.id);
        if (one.xpm_uuid) created.set(one.name, one.id);
        p.stats.entitiesCreated++;
      }
      continue;
    }
    for (const one of data ?? []) {
      created.set(one.xpm_uuid ?? one.name, one.id);
      if (one.xpm_uuid) created.set(one.name, one.id);
      p.stats.entitiesCreated++;
    }
  }
  return created;
}

// ── Phase: clients (paged) ─────────────────────────────────────────
interface ParsedClient {
  uuid: string;
  name: string;
  entityType: string;
  abn: string | null;
  acn: string | null;
  rels: { type: string; uuid: string; name: string }[];
}

/** Parse one XPM client page down to a minimal shape, then drop the XML. */
function parseClientPage(pageXml: any, p: Progress): ParsedClient[] {
  const clients = xmlArray(pageXml?.Response?.Clients, "Client");
  const out: ParsedClient[] = [];

  for (const c of clients) {
    const uuid = xmlText(c, "UUID");
    const name = xmlText(c, "Name") || `${xmlText(c, "FirstName")} ${xmlText(c, "LastName")}`.trim();
    if (!uuid || !name) continue;

    const entityType = resolveEntityType(xmlText(c, "BusinessStructure"));
    const rels: ParsedClient["rels"] = [];

    for (const rel of xmlArray(c?.Relationships, "Relationship")) {
      const raw = (xmlText(rel, "Type") || xmlText(rel, "RelationshipType")).trim().toLowerCase();
      const relatedUuid = xmlText(rel?.RelatedClient, "UUID") || xmlText(rel, "RelatedClientUUID");
      const relatedName = xmlText(rel?.RelatedClient, "Name") || xmlText(rel, "RelatedClientName");
      if (!raw || !relatedUuid) continue;
      const mapped = REL_TYPE_MAP[raw];
      if (!mapped) {
        warn(p, `Unknown relationship type "${raw}" on client ${name}`);
        p.stats.relationshipsSkipped++;
        continue;
      }
      rels.push({ type: mapped, uuid: relatedUuid, name: relatedName });
    }

    out.push({
      uuid,
      name,
      entityType,
      abn: xmlText(c, "TaxNumber") || xmlText(c, "ABN") || null,
      acn: xmlText(c, "CompanyNumber") || xmlText(c, "ACN") || null,
      rels,
    });
  }

  return out;
}

/** Returns true when the page had clients (i.e. more pages may follow). */
async function processClientPage(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  page: number,
  p: Progress,
): Promise<boolean> {
  const t = tuning();
  let pageXml: any = await xpmGetXml(
    `/client.api/list?detailed=true&page=${page}&pagesize=${t.clientPageSize}`,
    accessToken,
    xeroTenantId,
  );
  if (!pageXml) return false;

  const parsed = parseClientPage(pageXml, p);
  // Release the parsed XML tree (the biggest allocation in the run) immediately.
  pageXml = null;
  if (parsed.length === 0) return false;
  p.stats.clientsFetched += parsed.length;


  // Everything referenced by this page (clients + their related clients).
  const uuids = new Set<string>();
  const names = new Set<string>();
  for (const c of parsed) {
    uuids.add(c.uuid);
    names.add(c.name);
    for (const r of c.rels) {
      uuids.add(r.uuid);
      if (r.name) names.add(r.name);
    }
  }

  const { byUuid, byName } = await resolveExisting(
    supabase,
    tenantId,
    [...uuids],
    [...names],
    t.dbBatchSize,
  );

  const idByUuid = new Map<string, string>();
  const toInsert: Record<string, unknown>[] = [];
  const trusteePairs: { entityId?: string; uuid: string; trustName: string }[] = [];
  // Collected first, then issued with bounded concurrency — unchanged records
  // produce no write at all.
  const pendingUpdates: { id: string; updates: Record<string, unknown> }[] = [];

  for (const c of parsed) {
    const isTrustee = isCorporateTrustee(c.name, c.entityType);
    p.stats.typeCounts[c.entityType] = (p.stats.typeCounts[c.entityType] || 0) + 1;
    if (isTrustee) p.stats.trusteesDetected++;

    const existing = byUuid.get(c.uuid) ?? byName.get(c.name);
    if (existing) {
      idByUuid.set(c.uuid, existing.id);
      const updates: Record<string, unknown> = {};
      if (c.entityType !== "Unclassified" && existing.entity_type === "Unclassified") {
        updates.entity_type = c.entityType;
      }
      if (!existing.xpm_uuid) updates.xpm_uuid = c.uuid;
      if (c.abn && !existing.abn) updates.abn = c.abn;
      if (c.acn && !existing.acn) updates.acn = c.acn;
      if (isTrustee && !existing.is_trustee_company) updates.is_trustee_company = true;
      if (Object.keys(updates).length > 0) {
        updates.source = "imported";
        pendingUpdates.push({ id: existing.id, updates });
      }

    } else {
      toInsert.push({
        tenant_id: tenantId,
        name: c.name,
        xpm_uuid: c.uuid,
        entity_type: c.entityType,
        abn: c.abn,
        acn: c.acn,
        is_trustee_company: isTrustee,
        source: "imported",
      });
    }

    if (isTrustee) {
      const trustName = extractTrustName(c.name);
      if (trustName) trusteePairs.push({ uuid: c.uuid, trustName });
    }
  }

  // Related clients not present on this page and not in the DB yet.
  const known = new Set([...idByUuid.keys()]);
  const pendingInsertUuids = new Set(toInsert.map((r) => r.xpm_uuid as string));
  for (const c of parsed) {
    for (const r of c.rels) {
      if (known.has(r.uuid) || pendingInsertUuids.has(r.uuid)) continue;
      const existing = byUuid.get(r.uuid) ?? (r.name ? byName.get(r.name) : undefined);
      if (existing) {
        idByUuid.set(r.uuid, existing.id);
        known.add(r.uuid);
        continue;
      }
      if (!r.name) continue;
      pendingInsertUuids.add(r.uuid);
      toInsert.push({
        tenant_id: tenantId,
        name: r.name,
        xpm_uuid: r.uuid,
        entity_type: "Unclassified",
        source: "imported",
      });
    }
  }

  if (pendingUpdates.length > 0) {
    await mapLimit(pendingUpdates, t.dbConcurrency, async (u) => {
      const { error } = await supabase.from("entities").update(u.updates).eq("id", u.id);
      if (!error) p.stats.entitiesUpdated++;
      else warn(p, `Failed to update entity ${u.id}: ${error.message}`);
    });
  }

  const createdKeys = await bulkInsertEntities(supabase, toInsert, t.dbBatchSize, p);

  for (const row of toInsert) {
    const id = createdKeys.get(row.xpm_uuid as string) ?? createdKeys.get(row.name as string);
    if (id) idByUuid.set(row.xpm_uuid as string, id);
  }

  // ── Relationships (deduped, bulk-checked, bulk-inserted) ──────────
  const wanted = new Map<string, { from: string; to: string; type: string }>();
  for (const c of parsed) {
    const fromBase = idByUuid.get(c.uuid);
    if (!fromBase) continue;
    for (const r of c.rels) {
      const toBase = idByUuid.get(r.uuid);
      if (!toBase) {
        p.stats.relationshipsSkipped++;
        continue;
      }
      let from = fromBase;
      let to = toBase;
      if ((r.type === "spouse" || r.type === "partner") && from > to) [from, to] = [to, from];
      wanted.set(`${r.type}:${from}:${to}`, { from, to, type: r.type });
    }
  }

  // Trustee-by-name pairs (bounded per page, bounded concurrency).
  const trusteeLookups = trusteePairs.filter((pair) => idByUuid.has(pair.uuid));
  await mapLimit(trusteeLookups, t.dbConcurrency, async (pair) => {
    const trusteeId = idByUuid.get(pair.uuid)!;
    const { data: trust } = await supabase
      .from("entities")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${pair.trustName}%`)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (trust) wanted.set(`trustee:${trusteeId}:${trust.id}`, { from: trusteeId, to: trust.id, type: "trustee" });
  });


  if (wanted.size > 0) {
    const fromIds = [...new Set([...wanted.values()].map((w) => w.from))];
    const existingKeys = new Set<string>();
    for (const part of chunk(fromIds, t.dbBatchSize)) {
      const { data } = await supabase
        .from("relationships")
        .select("from_entity_id, to_entity_id, relationship_type")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .in("from_entity_id", part);
      for (const row of data ?? []) {
        existingKeys.add(`${row.relationship_type}:${row.from_entity_id}:${row.to_entity_id}`);
      }
    }

    const relRows = [...wanted.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([, w]) => ({
        tenant_id: tenantId,
        from_entity_id: w.from,
        to_entity_id: w.to,
        relationship_type: w.type,
        source: "imported",
        confidence: "imported",
      }));

    for (const part of chunk(relRows, t.dbBatchSize)) {
      const { data, error } = await supabase.from("relationships").insert(part).select("id");
      if (error) {
        // Relationship rules are enforced by trigger — retry individually.
        for (const row of part) {
          const { error: oneErr } = await supabase.from("relationships").insert(row);
          if (oneErr) {
            p.stats.relationshipsSkipped++;
            warn(p, `Skipped ${row.relationship_type} relationship: ${oneErr.message}`);
          } else {
            p.stats.relationshipsCreated++;
          }
        }
        continue;
      }
      p.stats.relationshipsCreated += data?.length ?? part.length;
    }
  }

  return true;
}

// ── Phase: groups ──────────────────────────────────────────────────
/**
 * Pull the group catalogue from XPM once and persist it to `xpm_groups`.
 * The list is never kept on the job row: the group phase pages through the
 * table by `xpm_uuid` cursor instead, so job-row size is O(1).
 */
async function loadGroupList(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  p: Progress,
) {
  let groupXml: any = await xpmGetXml("/clientgroup.api/list", accessToken, xeroTenantId);
  const groups = xmlArray(groupXml?.Response?.Groups, "Group")
    .map((g: any) => ({ uuid: xmlText(g, "UUID"), name: xmlText(g, "Name") }))
    .filter((g) => g.uuid && g.name);
  groupXml = null;

  p.stats.groupsFound = groups.length;

  const t = tuning();
  const now = new Date().toISOString();
  for (const part of chunk(groups, t.dbBatchSize)) {
    const { error } = await supabase.from("xpm_groups").upsert(
      part.map((g) => ({ tenant_id: tenantId, xpm_uuid: g.uuid, name: g.name, updated_at: now })),
      { onConflict: "tenant_id,xpm_uuid" },
    );
    if (error) warn(p, `Failed to persist group batch: ${error.message}`);
  }

  p.groupsLoaded = true;
}

/** Next slice of groups to process, ordered by `xpm_uuid` after the cursor. */
async function fetchGroupSlice(
  supabase: any,
  tenantId: string,
  cursor: string,
  limit: number,
): Promise<{ uuid: string; name: string }[]> {
  let q = supabase
    .from("xpm_groups")
    .select("xpm_uuid, name")
    .eq("tenant_id", tenantId)
    .order("xpm_uuid", { ascending: true })
    .limit(limit);
  if (cursor) q = q.gt("xpm_uuid", cursor);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to read group slice: ${error.message}`);
  return (data ?? []).map((r: any) => ({ uuid: r.xpm_uuid, name: r.name }));
}


async function processGroup(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  group: { uuid: string; name: string },
  p: Progress,
) {
  const t = tuning();
  const detail = await xpmGetXml(`/clientgroup.api/get/${group.uuid}`, accessToken, xeroTenantId);
  const memberUuids = xmlArray(detail?.Response?.Group?.Clients, "Client")
    .map((m: any) => xmlText(m, "UUID"))
    .filter(Boolean);

  const { data: existingStruct } = await supabase
    .from("structures")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", group.name)
    .is("deleted_at", null)
    .maybeSingle();

  let structureId: string;
  if (existingStruct) {
    structureId = existingStruct.id;
  } else {
    const { data: newStruct, error } = await supabase
      .from("structures")
      .insert({ tenant_id: tenantId, name: group.name })
      .select("id")
      .single();
    if (error) {
      warn(p, `Failed to create structure for group "${group.name}": ${error.message}`);
      return;
    }
    structureId = newStruct.id;
    p.stats.groupsCreated++;
  }

  if (memberUuids.length === 0) return;

  const memberEntityIds: string[] = [];
  for (const part of chunk(memberUuids, t.dbBatchSize)) {
    const { data } = await supabase
      .from("entities")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("xpm_uuid", part);
    for (const row of data ?? []) memberEntityIds.push(row.id);
  }
  if (memberEntityIds.length === 0) return;

  for (const part of chunk(memberEntityIds, t.dbBatchSize)) {
    await supabase.from("structure_entities").upsert(
      part.map((entity_id) => ({ structure_id: structureId, entity_id })),
      { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
    );
  }

  const relIds: string[] = [];
  for (const part of chunk(memberEntityIds, t.dbBatchSize)) {
    const { data } = await supabase
      .from("relationships")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("from_entity_id", part);
    for (const row of data ?? []) relIds.push(row.id);
  }

  for (const part of chunk(relIds, tuning().dbBatchSize)) {
    await supabase.from("structure_relationships").upsert(
      part.map((relationship_id) => ({ structure_id: structureId, relationship_id })),
      { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
    );
  }
}

// ── Phase: staff + fallback structure ──────────────────────────────
async function processStaff(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  p: Progress,
) {
  const t = tuning();
  const staffXml = await xpmGetXml("/staff.api/list", accessToken, xeroTenantId);
  if (!staffXml) {
    warn(p, "Staff endpoint returned no data (may require practicemanager.staff.read scope)");
    return;
  }

  const names = xmlArray(staffXml?.Response?.StaffList, "Staff")
    .map((s: any) => xmlText(s, "Name") || `${xmlText(s, "FirstName")} ${xmlText(s, "LastName")}`.trim())
    .filter(Boolean);
  p.stats.staffFetched = names.length;

  const existing = new Set<string>();
  for (const part of chunk([...new Set(names)], t.dbBatchSize)) {
    const { data } = await supabase
      .from("entities")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("entity_type", "Individual")
      .is("deleted_at", null)
      .in("name", part);
    for (const row of data ?? []) existing.add(row.name);
  }

  const rows = [...new Set(names)]
    .filter((n) => !existing.has(n))
    .map((name) => ({ tenant_id: tenantId, name, entity_type: "Individual", source: "imported" }));

  await bulkInsertEntities(supabase, rows, t.dbBatchSize, p);
}

async function ensureFallbackStructure(supabase: any, tenantId: string, p: Progress) {
  if (p.stats.groupsFound > 0) return;
  if (p.stats.entitiesCreated === 0 && p.stats.entitiesUpdated === 0) return;

  const t = tuning();
  const { data: existing } = await supabase
    .from("structures")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "XPM Import")
    .is("deleted_at", null)
    .maybeSingle();

  let structureId = existing?.id as string | undefined;
  if (!structureId) {
    const { data: created } = await supabase
      .from("structures")
      .insert({ tenant_id: tenantId, name: "XPM Import" })
      .select("id")
      .single();
    structureId = created?.id;
  }
  if (!structureId) return;

  // Stream imported entities in pages so nothing large sits in memory.
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await supabase
      .from("entities")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source", "imported")
      .is("deleted_at", null)
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const part of chunk(data.map((r: any) => r.id), t.dbBatchSize)) {
      await supabase.from("structure_entities").upsert(
        part.map((entity_id: string) => ({ structure_id: structureId, entity_id })),
        { onConflict: "structure_id,entity_id", ignoreDuplicates: true },
      );
    }
    if (data.length < PAGE) break;
  }

  for (let offset = 0; ; offset += PAGE) {
    const { data } = await supabase
      .from("relationships")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source", "imported")
      .is("deleted_at", null)
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const part of chunk(data.map((r: any) => r.id), t.dbBatchSize)) {
      await supabase.from("structure_relationships").upsert(
        part.map((relationship_id: string) => ({ structure_id: structureId, relationship_id })),
        { onConflict: "structure_id,relationship_id", ignoreDuplicates: true },
      );
    }
    if (data.length < PAGE) break;
  }
}

// ── One bounded slice of work ──────────────────────────────────────
async function runSlice(
  supabase: any,
  jobId: string,
  tenantId: string,
  progress: Progress,
): Promise<Progress> {
  const t = tuning();
  const p = progress;
  p.runs++;

  const { data: connections } = await supabase
    .from("xero_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("connected_at", { ascending: false })
    .limit(1);
  if (!connections?.length) throw new Error("No Xero connection found");

  const accessToken = await refreshAccessToken(supabase, connections[0]);
  // Discover the Practice Manager tenant once, then persist it so later slices
  // skip the extra /connections round-trip entirely.
  let xeroTenantId = connections[0].xero_tenant_id as string | null;
  if (!xeroTenantId) {
    xeroTenantId = await discoverPmTenantId(accessToken, null);
    if (xeroTenantId) {
      await supabase
        .from("xero_connections")
        .update({ xero_tenant_id: xeroTenantId, updated_at: new Date().toISOString() })
        .eq("id", connections[0].id);
    }
  }
  if (!xeroTenantId) throw new Error("Xero tenant ID not available");

  if (p.phase === "clients") {
    for (let i = 0; i < t.clientPagesPerRun; i++) {
      const hadClients = await processClientPage(
        supabase, tenantId, accessToken, xeroTenantId, p.clientPage, p,
      );
      if (!hadClients || p.clientPage >= t.maxClientPages) {
        p.phase = "groups";
        break;
      }
      p.clientPage++;
    }
  } else if (p.phase === "groups") {
    if (!p.groupsLoaded) {
      await loadGroupList(supabase, tenantId, accessToken, xeroTenantId, p);
    }
    const slice = await fetchGroupSlice(supabase, tenantId, p.groupCursor, t.groupsPerRun);
    if (slice.length === 0) {
      p.phase = "staff";
    } else {
      // Bounded concurrency: several groups in flight, never all of them.
      await mapLimit(slice, t.groupConcurrency, (group) =>
        processGroup(supabase, tenantId, accessToken, xeroTenantId!, group, p)
      );
      p.stats.groupsProcessed += slice.length;
      p.groupCursor = slice[slice.length - 1].uuid;
      if (slice.length < t.groupsPerRun) p.phase = "staff";
    }
  } else if (p.phase === "staff") {
    await processStaff(supabase, tenantId, accessToken, xeroTenantId, p);
    await ensureFallbackStructure(supabase, tenantId, p);
    p.phase = "done";
  }

  p.updated_at = new Date().toISOString();
  return p;
}

async function saveProgress(supabase: any, jobId: string, p: Progress) {
  const done = p.phase === "done";
  await supabase
    .from("import_logs")
    .update({
      status: done ? "completed" : "processing",
      result: {
        success: done,
        dataSource: "practicemanager_3.1_xml",
        phase: p.phase,
        progress: {
          clientPage: p.clientPage,
          groupCursor: p.groupCursor,
          groupsLoaded: p.groupsLoaded,
          groupsProcessed: p.stats.groupsProcessed,
          groupsTotal: p.stats.groupsFound,
          runs: p.runs,
        },
        ...p.stats,
        // Keep the row bounded: only the most recent warnings are retained.
        warnings: p.warnings.slice(-50),
        started_at: p.started_at,
        updated_at: p.updated_at,
      },
    })
    .eq("id", jobId);
}


/** Kick a fresh worker to continue the same job. */
async function continueJob(jobId: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-xpm`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ continue_job: jobId }),
  }).catch((e) => console.error("[sync-xpm] continuation failed:", e));
}

function loadProgress(result: any): Progress {
  const base = emptyProgress();
  if (!result || typeof result !== "object") return base;
  return {
    ...base,
    phase: (result.phase as Phase) ?? base.phase,
    clientPage: result.progress?.clientPage ?? base.clientPage,
    groupCursor: result.progress?.groupCursor ?? base.groupCursor,
    groupsLoaded: result.progress?.groupsLoaded ?? base.groupsLoaded,

    runs: result.progress?.runs ?? 0,
    started_at: result.started_at ?? base.started_at,
    stats: {
      ...base.stats,
      clientsFetched: result.clientsFetched ?? 0,
      entitiesCreated: result.entitiesCreated ?? 0,
      entitiesUpdated: result.entitiesUpdated ?? 0,
      relationshipsCreated: result.relationshipsCreated ?? 0,
      relationshipsSkipped: result.relationshipsSkipped ?? 0,
      groupsFound: result.groupsFound ?? 0,
      groupsCreated: result.groupsCreated ?? 0,
      groupsProcessed: result.groupsProcessed ?? result.progress?.groupsProcessed ?? 0,
      trusteesDetected: result.trusteesDetected ?? 0,

      staffFetched: result.staffFetched ?? 0,
      typeCounts: result.typeCounts ?? {},
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 200) : [],
  };
}

/** Runs a slice in the background, persists progress, and chains the next run. */
function scheduleSlice(supabase: any, jobId: string, tenantId: string, progress: Progress) {
  const task = (async () => {
    try {
      const next = await runSlice(supabase, jobId, tenantId, progress);
      await saveProgress(supabase, jobId, next);
      if (next.phase !== "done") await continueJob(jobId);
      else console.log(`[sync-xpm] job ${jobId} completed in ${next.runs} runs`);
    } catch (e) {
      const fatal = e instanceof FatalXpmError;
      console.error(`[sync-xpm] slice error${fatal ? " (fatal)" : ""}:`, e);
      await supabase
        .from("import_logs")
        .update({
          status: "failed",
          result: {
            success: false,
            phase: progress.phase,
            requiresReconnect: fatal,
            error: e instanceof Error ? e.message : String(e),
            ...progress.stats,
            progress: {
              clientPage: progress.clientPage,
              groupCursor: progress.groupCursor,
              groupsLoaded: progress.groupsLoaded,
              groupsProcessed: progress.stats.groupsProcessed,
              groupsTotal: progress.stats.groupsFound,
              runs: progress.runs,
            },
            warnings: progress.warnings.slice(-50),
          },
        })
        .eq("id", jobId);
    }

  })();
  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
  EdgeRuntime.waitUntil(task);
}

// ── HTTP entrypoint ────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authHeader = req.headers.get("authorization") ?? "";

    // ── Internal continuation (service-role only) ──────────────────
    if (body.continue_job) {
      if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

      const { data: job } = await supabase
        .from("import_logs")
        .select("id, tenant_id, status, result")
        .eq("id", body.continue_job)
        .maybeSingle();
      if (!job) return json({ error: "Job not found" }, 404);
      if (job.status !== "processing") return json({ skipped: true, status: job.status });

      scheduleSlice(supabase, job.id, job.tenant_id, loadProgress(job.result));
      return json({ continued: true, jobId: job.id }, 202);
    }

    // ── User-initiated sync ───────────────────────────────────────
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) return json({ error: "No tenant found" }, 400);

    const { data: callerRole } = await supabase
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!callerRole || !["owner", "admin"].includes(callerRole.role)) {
      return json({ error: "Admin access required" }, 403);
    }

    const { data: connections } = await supabase
      .from("xero_connections")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1);
    if (!connections?.length) {
      return json({ error: "No Xero connection found. Please connect to Xero first." }, 400);
    }

    // Don't start a second sync while one is still running.
    const staleCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: running } = await supabase
      .from("import_logs")
      .select("id, updated_at")
      .eq("tenant_id", tenantId)
      .eq("file_name", JOB_FILE_NAME)
      .eq("status", "processing")
      .gt("updated_at", staleCutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (running) {
      return json({
        started: true,
        alreadyRunning: true,
        jobId: running.id,
        message: "An XPM sync is already running. Refresh the dashboard shortly to see progress.",
      }, 202);
    }

    const progress = emptyProgress();
    const { data: jobRow, error: jobErr } = await supabase
      .from("import_logs")
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        file_name: JOB_FILE_NAME,
        status: "processing",
        result: { phase: progress.phase, started_at: progress.started_at, ...progress.stats },
      })
      .select("id")
      .single();
    if (jobErr || !jobRow) return json({ error: jobErr?.message ?? "Failed to start sync" }, 500);

    scheduleSlice(supabase, jobRow.id, tenantId, progress);

    return json({
      started: true,
      jobId: jobRow.id,
      message:
        "XPM sync started. It runs in batches across multiple background executions — refresh the dashboard shortly to see progress.",
    }, 202);
  } catch (err) {
    console.error("[sync-xpm] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
