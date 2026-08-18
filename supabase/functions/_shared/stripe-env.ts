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
 * Variables that MUST exist as STRIPE_LIVE_* when running in live mode.
 * Missing/empty values are a hard configuration error — never a sandbox fallback.
 */
export const REQUIRED_LIVE_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_STARTER_PRODUCT_ID",
  "STRIPE_PRO_PRODUCT_ID",
  "STRIPE_STARTER_MONTHLY_PRICE_ID",
  "STRIPE_STARTER_ANNUAL_PRICE_ID",
  "STRIPE_PRO_MONTHLY_PRICE_ID",
  "STRIPE_PRO_ANNUAL_PRICE_ID",
] as const;

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

/**
 * Resolve a logical Stripe env var for the active mode.
 *
 * live mode: ONLY the STRIPE_LIVE_* value is ever used. There is no fallback to
 *   the sandbox name — required vars throw StripeConfigError, optional ones
 *   resolve to undefined. This makes it impossible for live billing to silently
 *   use sandbox credentials, product IDs or price IDs.
 * test mode: the existing STRIPE_* (sandbox) variables, unchanged.
 */
export function stripeVar(name: string, modeOverride?: StripeMode): string | undefined {
  if ((modeOverride ?? stripeMode()) === "live") {
    const liveName = liveVarName(name);
    const live = Deno.env.get(liveName);
    if (live && live.trim() !== "") return live.trim();
    if ((REQUIRED_LIVE_VARS as readonly string[]).includes(name)) {
      throw new StripeConfigError(
        `Stripe live mode misconfigured: ${liveName} is missing or empty. Set it for this environment; live billing will never fall back to the sandbox variable ${name}.`,
      );
    }
    return undefined;
  }
  const base = Deno.env.get(name);
  return base && base.trim() !== "" ? base.trim() : undefined;
}

/** Non-throwing variant for diagnostics/reporting surfaces. */
export function stripeVarSafe(name: string, modeOverride?: StripeMode): string | undefined {
  try {
    return stripeVar(name, modeOverride);
  } catch {
    return undefined;
  }
}

/** Required live vars that are missing/empty (live mode only). */
export function missingLiveVars(): string[] {
  if (stripeMode() !== "live") return [];
  return REQUIRED_LIVE_VARS.filter((name) => {
    const v = Deno.env.get(liveVarName(name));
    return !v || v.trim() === "";
  }).map((name) => liveVarName(name));
}


/** Which env var name actually supplied the value (for diagnostics only). */
export function stripeVarSource(name: string, modeOverride?: StripeMode): string | null {
  if ((modeOverride ?? stripeMode()) === "live") {
    const live = Deno.env.get(liveVarName(name));
    // Live mode never reads the sandbox name, so it can never be the source.
    return live && live.trim() !== "" ? liveVarName(name) : null;
  }
  const base = Deno.env.get(name);
  return base && base.trim() !== "" ? name : null;
}
