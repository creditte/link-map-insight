/** Shared helpers for the chunked XPM sync. */
import { decryptToken, encryptToken } from "../_shared/crypto.ts";
import { parse as parseXml } from "https://deno.land/x/xml@6.0.1/mod.ts";

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
    /** XPM client pages fetched+persisted per execution. */
    clientPagesPerRun: num("XPM_CLIENT_PAGES_PER_RUN", 2),
    /** XPM client page size (XPM caps this server-side). */
    clientPageSize: num("XPM_CLIENT_PAGE_SIZE", 100),
    /** Client groups processed per execution. */
    groupsPerRun: num("XPM_GROUPS_PER_RUN", 10),
    /** Rows per bulk DB statement. */
    dbBatchSize: num("XPM_DB_BATCH_SIZE", 200),
    /** Safety cap on pages so a broken cursor can't loop forever. */
    maxClientPages: num("XPM_MAX_CLIENT_PAGES", 500),
  };
}

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
export async function xpmGetXml(path: string, accessToken: string, xeroTenantId: string): Promise<any> {
  const url = `${XPM_BASE}${path}`;
  console.log(`[sync-xpm] GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": xeroTenantId,
      Accept: "application/xml",
    },
  });

  if (res.status === 304) return null;
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[sync-xpm] ${res.status} on ${path}: ${errText.substring(0, 200)}`);
    return null;
  }
  const text = await res.text();
  try {
    return parseXml(text);
  } catch (e) {
    console.warn(`[sync-xpm] XML parse error on ${path}:`, e);
    return null;
  }
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
