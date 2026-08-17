// Explicit Stripe test/live mode separation.
//
// Billing logic is untouched: every function still reads the SAME logical env
// var names (STRIPE_SECRET_KEY, STRIPE_*_PRICE_ID, ...). The only change is
// that in live mode those names resolve to their `STRIPE_LIVE_*` counterparts
// first, so the existing sandbox/test configuration is never overwritten.
//
// Mode selection (per environment, no code changes required):
//   STRIPE_MODE = "live"  -> production: reads STRIPE_LIVE_* then falls back to base name
//   STRIPE_MODE unset/"test" -> preview/dev: reads the existing (sandbox) names only
//
// Naming convention for live secrets: insert `LIVE_` after `STRIPE_`, e.g.
//   STRIPE_SECRET_KEY            -> STRIPE_LIVE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET        -> STRIPE_LIVE_WEBHOOK_SECRET
//   STRIPE_STARTER_PRODUCT_ID    -> STRIPE_LIVE_STARTER_PRODUCT_ID
//   STRIPE_PRO_ANNUAL_PRICE_ID   -> STRIPE_LIVE_PRO_ANNUAL_PRICE_ID

export type StripeMode = "test" | "live";

/** Active Stripe mode for THIS environment. Defaults to test (safe). */
export function stripeMode(): StripeMode {
  const raw = (Deno.env.get("STRIPE_MODE") ?? "").trim().toLowerCase();
  return raw === "live" || raw === "production" || raw === "prod" ? "live" : "test";
}

/** Live-mode name for a logical Stripe env var. */
export function liveVarName(name: string): string {
  return name.startsWith("STRIPE_") ? name.replace("STRIPE_", "STRIPE_LIVE_") : `LIVE_${name}`;
}

/**
 * Resolve a logical Stripe env var for the active mode.
 * In live mode the STRIPE_LIVE_* value wins; the base name remains a fallback
 * so an environment configured with only live values still works.
 */
export function stripeVar(name: string): string | undefined {
  if (stripeMode() === "live") {
    const live = Deno.env.get(liveVarName(name));
    if (live && live.trim() !== "") return live.trim();
  }
  const base = Deno.env.get(name);
  return base && base.trim() !== "" ? base.trim() : undefined;
}

/** Which env var name actually supplied the value (for diagnostics only). */
export function stripeVarSource(name: string): string | null {
  if (stripeMode() === "live") {
    const live = Deno.env.get(liveVarName(name));
    if (live && live.trim() !== "") return liveVarName(name);
  }
  const base = Deno.env.get(name);
  return base && base.trim() !== "" ? name : null;
}
