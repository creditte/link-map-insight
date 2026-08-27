/** Shared helpers for the chunked XPM sync. */
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
// esm.sh mirror of jsr:@libs/xml — the deno.land/x mirror fails to bundle.
import { parse as parseXml } from "https://esm.sh/jsr/@libs/xml@6.0.1";


export const XPM_BASE = "https://api.xero.com/practicemanager/3.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Tunables (env-overridable) ─────────────────────────────────────
export function tuning() {
  const num = (k: string, d: number) => {
    const v = Number(Deno.env.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    /**
     * XPM client pages fetched+persisted per execution. A detailed page can hold
     * >1,000 clients, and parsing one costs several seconds of the worker's CPU
     * budget, so the default is deliberately small and `sliceBudgetMs` stops the
     * slice early when a page turns out to be huge.
     */
    clientPagesPerRun: num("XPM_CLIENT_PAGES_PER_RUN", 2),
    /**
     * Soft budget for one execution. Exceeding it ends the slice cleanly and
     * chains a fresh worker, instead of being killed with "CPU Time exceeded"
     * and losing the in-flight page.
     */
    sliceBudgetMs: num("XPM_SLICE_BUDGET_MS", 5000),
    /** XPM client page size (XPM caps this server-side). */
    clientPageSize: num("XPM_CLIENT_PAGE_SIZE", 50),
    /** Client groups processed per execution. */
    groupsPerRun: num("XPM_GROUPS_PER_RUN", 120),
    /** Groups fetched concurrently from XPM within a run. */
    groupConcurrency: num("XPM_GROUP_CONCURRENCY", 3),
    /**
     * Minimum gap between XPM requests. Xero enforces ~60 calls/minute per
     * tenant and answers bursts with a 429 that parks the worker for 25-30s,
     * so pacing below the limit is strictly faster than being throttled.
     */
    xpmMinIntervalMs: num("XPM_MIN_INTERVAL_MS", 1050),
    /**
     * Groups whose membership was read from XPM more recently than this are
     * skipped without an XPM call. Group membership has no change feed, so this
     * freshness window is what keeps routine syncs quick.
     */
    groupFreshnessMinutes: num("XPM_GROUP_FRESHNESS_MINUTES", 1440),
    /** Groups linked per database request (one round trip per batch). */
    groupBatchSize: num("XPM_GROUP_BATCH_SIZE", 24),
    /** Concurrency for small independent DB statements (updates, lookups). */
    dbConcurrency: num("XPM_DB_CONCURRENCY", 6),
    /** Rows per bulk DB statement. */
    dbBatchSize: num("XPM_DB_BATCH_SIZE", 500),
    /**
     * Max values per `.in(...)` filter. These are encoded in the request URL,
     * so large batches produce multi-kilobyte URLs that PostgREST/HTTP2
     * rejects with an "unspecific protocol error".
     */
    filterBatchSize: num("XPM_FILTER_BATCH_SIZE", 80),
    /** Safety cap on pages so a broken cursor can't loop forever. */
    maxClientPages: num("XPM_MAX_CLIENT_PAGES", 500),
  };
}

/** Raised for failures that must abort the sync instead of being retried. */
export class FatalXpmError extends Error {}

/**
 * Per-worker counters. Used to report how many XPM HTTP requests a slice made
 * so sync cost is observable from the job row instead of guessed at.
 */
export const counters = { xpmRequests: 0, xpmRetries: 0, xpmMs: 0, dbCalls: 0, dbMs: 0 };

/** Counted + timed Supabase RPC call, so DB cost is observable per job. */
export async function rpcCall(supabase: any, fn: string, args: Record<string, unknown>) {
  const startedAt = Date.now();
  counters.dbCalls++;
  const res = await supabase.rpc(fn, args);
  counters.dbMs += Date.now() - startedAt;
  return res;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input
 * order. Used instead of Promise.all so hundreds of XPM/DB calls never fire
 * simultaneously.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialises XPM request start times so concurrent workers inside one execution
 * still respect Xero's per-minute cap. Requests queue on this chain and each one
 * waits until at least `xpmMinIntervalMs` has passed since the previous start.
 */
let xpmGate: Promise<void> = Promise.resolve();
async function awaitXpmSlot() {
  const minInterval = tuning().xpmMinIntervalMs;
  const mine = xpmGate.then(async () => {
    const wait = minInterval - (Date.now() - lastXpmStartedAt);
    if (wait > 0) await sleep(wait);
    lastXpmStartedAt = Date.now();
  });
  xpmGate = mine.catch(() => {});
  await mine;
}
let lastXpmStartedAt = 0;


// ── Token refresh ───────────────────────────────────────────────────
export async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);
  if (expiresAt.getTime() - Date.now() > 300_000) return currentAccessToken;

  console.log("[sync-xpm] Token expiring, refreshing...");
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
  await supabase
    .from("xero_connections")
    .update({
      access_token: await encryptToken(tokens.access_token),
      refresh_token: await encryptToken(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

// ── XPM API helpers ─────────────────────────────────────────────────
/**
 * GET + parse one XPM XML endpoint.
 *
 * - 401/403 → fatal (token/scope problem): abort, never retried in a loop.
 * - 429 → honours `Retry-After` (capped) and retries a bounded number of times.
 * - 5xx / network error → exponential backoff, bounded retries.
 * - 4xx (other) / 304 / unparseable → `null`, so a single bad record can't kill
 *   the whole sync.
 */
export async function xpmGetXml(
  path: string,
  accessToken: string,
  xeroTenantId: string,
  maxAttempts = 3,
): Promise<any> {
  const url = `${XPM_BASE}${path}`;
  const startedAt = Date.now();
  counters.xpmRequests++;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await awaitXpmSlot();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "xero-tenant-id": xeroTenantId,
          Accept: "application/xml",
        },
      });
    } catch (e) {
      if (attempt === maxAttempts) {
        console.warn(`[sync-xpm] network error on ${path}:`, e);
        return null;
      }
      counters.xpmRetries++;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (res.status === 304) {
      await res.body?.cancel();
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      const errText = (await res.text()).substring(0, 200);
      throw new FatalXpmError(
        `Xero rejected the request (${res.status}). The connection needs to be re-authorised. ${errText}`,
      );
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await res.body?.cancel();
      if (attempt === maxAttempts) {
        console.warn(`[sync-xpm] rate limited on ${path}, giving up this call`);
        return null;
      }
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 30) * 1000
        : 2000 * attempt;
      console.warn(`[sync-xpm] 429 on ${path}; waiting ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (res.status >= 500) {
      await res.body?.cancel();
      if (attempt === maxAttempts) {
        console.warn(`[sync-xpm] ${res.status} on ${path} after ${attempt} attempts`);
        return null;
      }
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[sync-xpm] ${res.status} on ${path}: ${errText.substring(0, 200)}`);
      return null;
    }

    const text = await res.text();
    counters.xpmMs += Date.now() - startedAt;
    try {
      return parseXml(text);
    } catch (e) {
      console.warn(`[sync-xpm] XML parse error on ${path}:`, e);
      return null;
    }
  }

  return null;
}


export function xmlArray(parent: any, key: string): any[] {
  if (!parent) return [];
  const val = parent[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export function xmlText(node: any, key: string): string {
  if (!node) return "";
  const val = node[key];
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val["#text"] !== undefined) return String(val["#text"]);
  return String(val);
}

export async function discoverPmTenantId(
  accessToken: string,
  storedTenantId: string | null,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const conns = await res.json();
      const pmConn = conns.find((c: any) => c.tenantType === "PRACTICEMANAGER");
      if (pmConn) return pmConn.tenantId;
    }
  } catch (e) {
    console.warn("[sync-xpm] Failed to fetch /connections:", e);
  }
  return storedTenantId;
}

// ── Mapping tables ──────────────────────────────────────────────────
const BUSINESS_STRUCTURE_MAP: Record<string, string> = {
  Individual: "Individual",
  Company: "Company",
  Trust: "Trust",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  "Trustee Company": "Company",
  "Discretionary Trust": "trust_discretionary",
  "Unit Trust": "trust_unit",
  "Hybrid Trust": "trust_hybrid",
  "Bare Trust": "trust_bare",
  "Testamentary Trust": "trust_testamentary",
  "Deceased Estate": "trust_deceased_estate",
  "Family Trust": "trust_family",
  "Self Managed Superannuation Fund": "smsf",
  SMSF: "smsf",
  "Super Fund": "smsf",
  SuperFund: "smsf",
};

export function resolveEntityType(businessStructure?: string): string {
  if (businessStructure) {
    const mapped = BUSINESS_STRUCTURE_MAP[businessStructure];
    if (mapped) return mapped;
    const lower = businessStructure.toLowerCase();
    for (const [key, val] of Object.entries(BUSINESS_STRUCTURE_MAP)) {
      if (key.toLowerCase() === lower) return val;
    }
  }
  return "Unclassified";
}

export const REL_TYPE_MAP: Record<string, string> = {
  "director of": "director",
  "trustee of": "trustee",
  "shareholder of": "shareholder",
  "beneficiary of": "beneficiary",
  "partner of": "partner",
  "appointer of": "appointer",
  "appointor of": "appointer",
  "settlor of": "settlor",
  "member of": "member",
  "spouse of": "spouse",
  "parent of": "parent",
  "child of": "child",
};

export function isCorporateTrustee(name: string, entityType: string): boolean {
  if (entityType !== "Company") return false;
  const lower = name.toLowerCase();
  return lower.includes("as trustee for") || lower.includes("atf ") || lower.includes(" atf") ||
    /\btrustee\b/.test(lower);
}

export function extractTrustName(name: string): string | null {
  const m = name.match(/(?:as\s+trustee\s+for|atf)\s+(.+)/i);
  return m ? m[1].trim() : null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
