/**
 * Central registry of React Query keys + freshness rules.
 *
 * Every shared resource in the app is fetched through one of these keys so
 * that multiple components/tabs requesting the same data hit the cache
 * instead of issuing duplicate network calls.
 *
 * Freshness is chosen per data type rather than one global refetch interval:
 *  - identity / permissions data changes rarely  → long staleTime
 *  - firm settings change only when edited here  → long staleTime
 *  - billing state can change in Stripe          → short staleTime
 *  - list data the user mutates in-app           → medium staleTime + invalidation
 */
export const qk = {
  profile: (userId?: string | null) => ["profile", userId ?? "anon"] as const,
  tenant: (tenantId?: string | null) => ["tenant", tenantId ?? "none"] as const,
  tenantUsers: (tenantId?: string | null) => ["tenant-users", tenantId ?? "none"] as const,
  myTenantUser: (userId?: string | null) => ["my-tenant-user", userId ?? "anon"] as const,
  xeroConnection: () => ["xero-connection"] as const,
  billing: (userId?: string | null) => ["billing", userId ?? "anon"] as const,
  feedback: (userId?: string | null) => ["feedback", userId ?? "anon"] as const,
  dashboardStats: (userId?: string | null) => ["dashboard-stats", userId ?? "anon"] as const,
  duplicateCount: (userId?: string | null) => ["duplicate-count", userId ?? "anon"] as const,
  favouriteGroups: (userId?: string | null) => ["favourite-groups", userId ?? "anon"] as const,
  xpmGroupsCached: () => ["xpm-groups-cached"] as const,
  recentStructures: (userId?: string | null) => ["recent-structures", userId ?? "anon"] as const,
  manualStructures: (userId?: string | null) => ["manual-structures", userId ?? "anon"] as const,
};

/** Freshness windows (ms) per data type. */
export const staleTimes = {
  /** Identity, roles, permissions — rarely change mid-session. */
  identity: 5 * 60_000,
  /** Firm settings / branding — only change from the Firm tab. */
  tenant: 5 * 60_000,
  /** Integration connection state — can change via OAuth round-trips. */
  integration: 2 * 60_000,
  /** Billing state — Stripe is source of truth, keep it tighter. */
  billing: 60_000,
  /** Lists the user creates/edits in-app. */
  list: 2 * 60_000,
  /** Aggregates / analytics. */
  stats: 2 * 60_000,
};
