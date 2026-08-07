// Shared Stripe subscription field access, compatible with the configured webhook API
// version (2026-02-25.clover) as well as older versions (e.g. 2025-08-27.basil).
//
// Why this exists:
// From API version 2025-03-31.acacia onward (and enforced in the clover releases),
// `current_period_start` / `current_period_end` were REMOVED from the Subscription
// object and now live on each Subscription Item (`subscription.items.data[].current_period_*`).
// Reading them off the Subscription directly yields `undefined`, which is why
// `tenants.current_period_end` was being written as NULL.
//
// Every helper below reads the new item-level shape first and falls back to the
// legacy top-level fields, so handlers work regardless of which API version
// produced the object (webhook payloads use the endpoint's version; SDK
// retrievals use the pinned version below).

import type Stripe from "https://esm.sh/stripe@18.5.0";

/**
 * API version pinned for all SDK calls. Kept in sync with the configured
 * webhook endpoint version so retrieved objects and webhook payloads share one shape.
 * Overridable via STRIPE_API_VERSION for controlled rollbacks.
 */
export const STRIPE_API_VERSION = (Deno.env.get("STRIPE_API_VERSION") ||
  "2026-02-25.clover") as Stripe.LatestApiVersion;

/** Convert a Stripe timestamp (unix seconds) or ISO string to an ISO string. */
export function toISO(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val <= 0) return null;
    return new Date(val * 1000).toISOString();
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

type AnySub = Stripe.Subscription & Record<string, any>;

/**
 * Current billing period for a subscription.
 * clover: taken from subscription items (earliest start / latest end across items).
 * legacy: falls back to the removed top-level fields.
 */
export function getSubscriptionPeriod(subscription: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const sub = subscription as AnySub;
  const items = sub.items?.data ?? [];

  const starts = items
    .map((i: any) => (typeof i?.current_period_start === "number" ? i.current_period_start : null))
    .filter((v: number | null): v is number => v !== null);
  const ends = items
    .map((i: any) => (typeof i?.current_period_end === "number" ? i.current_period_end : null))
    .filter((v: number | null): v is number => v !== null);

  const start = starts.length ? Math.min(...starts) : sub.current_period_start ?? null;
  const end = ends.length ? Math.max(...ends) : sub.current_period_end ?? null;

  return { start: toISO(start), end: toISO(end) };
}

/** Trial window (still top-level in clover, guarded for safety). */
export function getTrialPeriod(subscription: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const sub = subscription as AnySub;
  return { start: toISO(sub.trial_start), end: toISO(sub.trial_end) };
}

/** Unix seconds for trial end, or null. */
export function getTrialEndSeconds(subscription: Stripe.Subscription): number | null {
  const sub = subscription as AnySub;
  return typeof sub.trial_end === "number" ? sub.trial_end : null;
}

/**
 * Everything the app mirrors into `tenants` about a subscription's lifecycle,
 * normalised across API versions.
 */
export function getSubscriptionLifecycle(subscription: Stripe.Subscription): {
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  interval: string | null;
  priceAmount: number | null;
} {
  const sub = subscription as AnySub;
  const { start, end } = getSubscriptionPeriod(subscription);
  const trial = getTrialPeriod(subscription);
  const price = sub.items?.data?.[0]?.price;

  return {
    status: sub.status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    trialStart: trial.start,
    trialEnd: trial.end,
    // Newer API versions (clover / flexible billing_mode) express a scheduled
    // cancellation via `cancel_at` while leaving `cancel_at_period_end` false.
    // Treat either signal as "cancelling" so the app mirrors Stripe correctly.
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || Boolean(sub.cancel_at),

    cancelAt: toISO(sub.cancel_at),
    canceledAt: toISO(sub.canceled_at),
    endedAt: toISO(sub.ended_at),
    interval: price?.recurring?.interval ?? null,
    priceAmount: typeof price?.unit_amount === "number" ? price.unit_amount : null,
  };
}

/**
 * Resolve the subscription ID referenced by an invoice.
 * clover/basil moved `invoice.subscription` to `invoice.parent.subscription_details.subscription`.
 */
export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as Stripe.Invoice & Record<string, any>;
  const fromParent = inv.parent?.subscription_details?.subscription;
  const legacy = inv.subscription;
  const raw = fromParent ?? legacy ?? null;
  if (!raw) return null;
  return typeof raw === "string" ? raw : (raw.id ?? null);
}

/** Invoice billing period end, resilient to line-item-only payloads. */
export function getInvoicePeriodEnd(invoice: Stripe.Invoice): string | null {
  const inv = invoice as Stripe.Invoice & Record<string, any>;
  if (typeof inv.period_end === "number") return toISO(inv.period_end);
  const lineEnds = (inv.lines?.data ?? [])
    .map((l: any) => l?.period?.end)
    .filter((v: any) => typeof v === "number") as number[];
  return lineEnds.length ? toISO(Math.max(...lineEnds)) : null;
}
