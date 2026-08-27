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
  /** Groups whose XPM membership is unchanged since the last sync. */
  groupsSkippedUnchanged: number;
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
      groupsSkippedUnchanged: 0,
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

// ── Small helpers ──────────────────────────────────────────────────
/** Stable fingerprint of a group's membership, used for change detection. */
async function hashMembers(name: string, memberUuids: string[]): Promise<string> {
  const payload = `${name}\n${[...memberUuids].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bulk insert helper — only used for the small staff list. */
async function bulkInsertEntities(
  supabase: any,
  rows: Record<string, unknown>[],
  batchSize: number,
  p: Progress,
): Promise<void> {
  for (const part of chunk(rows, batchSize)) {
    const { data, error } = await supabase.from("entities").insert(part).select("id");
    if (error) {
      warn(p, `Failed to create ${part.length} staff entities: ${error.message}`);
      continue;
    }
    p.stats.entitiesCreated += data?.length ?? part.length;
  }
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

/**
 * Fetch one client page and persist it with a SINGLE database call.
 *
 * Everything the page implies (entity resolution by uuid/name, inserts,
 * field backfills, relationship de-duplication and insertion) happens inside
 * `sync_xpm_upsert_clients`, so a page costs 1 XPM request + 1 DB request
 * instead of the dozens of chunked lookups and per-row fallbacks it used to.
 *
 * Returns true when the page had clients (i.e. more pages may follow).
 */
async function processClientPage(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  page: number,
  p: Progress,
  trusteePairs: { trustee_uuid: string; trust_name: string }[],
): Promise<boolean> {
  const t = tuning();
  let pageXml: any = await xpmGetXml(
    `/client.api/list?detailed=true&page=${page}&pagesize=${t.clientPageSize}`,
    accessToken,
    xeroTenantId,
  );
  if (!pageXml) return false;

  let parsed: ParsedClient[] | null = parseClientPage(pageXml, p);
  // Release the parsed XML tree (the biggest allocation in the run) immediately.
  pageXml = null;
  if (parsed.length === 0) return false;
  p.stats.clientsFetched += parsed.length;

  const clients: Record<string, unknown>[] = [];
  const related = new Map<string, string>();
  const rels: Record<string, unknown>[] = [];

  for (const c of parsed) {
    const isTrustee = isCorporateTrustee(c.name, c.entityType);
    p.stats.typeCounts[c.entityType] = (p.stats.typeCounts[c.entityType] || 0) + 1;
    if (isTrustee) {
      p.stats.trusteesDetected++;
      const trustName = extractTrustName(c.name);
      if (trustName) trusteePairs.push({ trustee_uuid: c.uuid, trust_name: trustName });
    }

    clients.push({
      uuid: c.uuid,
      name: c.name,
      entity_type: c.entityType,
      abn: c.abn,
      acn: c.acn,
      is_trustee: isTrustee,
    });

    for (const r of c.rels) {
      if (r.name) related.set(r.uuid, r.name);
      rels.push({ type: r.type, from_uuid: c.uuid, to_uuid: r.uuid });
    }
  }

  // Drop the parsed page before the request so peak memory stays low.
  parsed = null;

  const { data, error } = await supabase.rpc("sync_xpm_upsert_clients", {
    _tenant_id: tenantId,
    _payload: {
      clients,
      related: [...related.entries()].map(([uuid, name]) => ({ uuid, name })),
      rels,
    },
  });
  if (error) throw new Error(`Client page ${page} failed: ${error.message}`);

  const res = (data ?? {}) as any;
  p.stats.entitiesCreated += res.entitiesCreated ?? 0;
  p.stats.entitiesUpdated += res.entitiesUpdated ?? 0;
  p.stats.relationshipsCreated += res.relationshipsCreated ?? 0;
  p.stats.relationshipsSkipped += res.relationshipsSkipped ?? 0;
  for (const w of res.warnings ?? []) warn(p, String(w));

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
    // `member_hash` is deliberately left untouched so previously synced groups
    // keep their fingerprint and can be skipped when unchanged.
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


/**
 * One XPM request + one database request per group. The database call resolves
 * the structure, links members and their relationships, and records a
 * membership fingerprint so an unchanged group short-circuits on the next sync.
 */
async function processGroup(
  supabase: any,
  tenantId: string,
  accessToken: string,
  xeroTenantId: string,
  group: { uuid: string; name: string },
  p: Progress,
) {
  let detail: any = await xpmGetXml(`/clientgroup.api/get/${group.uuid}`, accessToken, xeroTenantId);
  if (!detail) {
    warn(p, `Could not read group "${group.name}" from XPM`);
    return;
  }
  const memberUuids = xmlArray(detail?.Response?.Group?.Clients, "Client")
    .map((m: any) => xmlText(m, "UUID"))
    .filter(Boolean);
  detail = null;

  const memberHash = await hashMembers(group.name, memberUuids);

  const { data, error } = await supabase.rpc("sync_xpm_link_group", {
    _tenant_id: tenantId,
    _group_uuid: group.uuid,
    _group_name: group.name,
    _member_uuids: memberUuids,
    _member_hash: memberHash,
  });

  if (error) {
    warn(p, `Failed to sync group "${group.name}": ${error.message}`);
    return;
  }

  const res = (data ?? {}) as any;
  if (res.skipped) {
    p.stats.groupsSkippedUnchanged++;
    return;
  }
  if (res.error) {
    warn(p, `Failed to create structure for group "${group.name}": ${res.error}`);
    return;
  }
  if (res.structureCreated) p.stats.groupsCreated++;
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
  for (const part of chunk([...new Set(names)], t.filterBatchSize)) {
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

/**
 * Only used when the practice has no client groups at all. Scoped to records
 * touched by THIS sync (one INSERT … SELECT per table), so it never rescans the
 * tenant's whole entity/relationship history like the paged version did.
 */
async function ensureFallbackStructure(supabase: any, tenantId: string, p: Progress) {
  if (p.stats.groupsFound > 0) return;
  if (p.stats.entitiesCreated === 0 && p.stats.entitiesUpdated === 0) return;

  const { error } = await supabase.rpc("sync_xpm_ensure_fallback_structure", {
    _tenant_id: tenantId,
    _since: p.started_at,
  });
  if (error) warn(p, `Failed to build fallback structure: ${error.message}`);
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

  // Heartbeat BEFORE any heavy XPM/XML work so a worker that dies mid-page
  // leaves a visible, reap-able timestamp instead of a silently stuck job.
  p.updated_at = new Date().toISOString();
  await saveProgress(supabase, jobId, p);

  if (p.phase === "clients") {
    const trusteePairs: { trustee_uuid: string; trust_name: string }[] = [];
    for (let i = 0; i < t.clientPagesPerRun; i++) {
      const hadClients = await processClientPage(
        supabase, tenantId, accessToken, xeroTenantId, p.clientPage, p, trusteePairs,
      );
      if (!hadClients || p.clientPage >= t.maxClientPages) {
        p.phase = "groups";
        break;
      }
      p.clientPage++;
      // Persist after every page: progress is never lost, and the job row's
      // `updated_at` proves the worker is alive.
      p.updated_at = new Date().toISOString();
      await saveProgress(supabase, jobId, p);
    }

    // Corporate trustee → trust matching for this run, resolved set-based in a
    // single call instead of one wildcard query per trustee.
    if (trusteePairs.length > 0) {
      const { data, error } = await supabase.rpc("sync_xpm_link_trustees", {
        _tenant_id: tenantId,
        _pairs: trusteePairs,
      });
      if (error) warn(p, `Trustee matching failed: ${error.message}`);
      else p.stats.relationshipsCreated += (data as any)?.relationshipsCreated ?? 0;
    }
  } else if (p.phase === "groups") {
    if (!p.groupsLoaded) {
      await loadGroupList(supabase, tenantId, accessToken, xeroTenantId, p);
      p.updated_at = new Date().toISOString();
      await saveProgress(supabase, jobId, p);
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
      groupsSkippedUnchanged: result.groupsSkippedUnchanged ?? 0,
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
    // Mark abandoned workers as failed so a dead job never blocks a new sync
    // and is visible to the user instead of sitting in "processing" forever.
    await supabase.rpc("fail_stale_import_jobs", { _max_idle_minutes: 10 });

    const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
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
