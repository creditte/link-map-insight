// Single source of truth for Stripe product/price -> plan mapping.
// Used by stripe-webhooks, switch-billing-interval and reconcile-billing so
// every code path resolves plans and diagram limits identically, with no
// implicit fallbacks to another plan.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import { stripeVar } from "./stripe-env.ts";

export type PlanConfig = { plan: string; diagramLimit: number };

export const PLAN_DIAGRAM_LIMITS: Record<string, number> = {
  starter: 15,
  pro: 50,
};

export function parseIdList(name: string): string[] {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function legacyPriceIds(): string[] {
  return parseIdList("STRIPE_LEGACY_PRICE_IDS");
}

export function buildPriceMap(): Record<string, Record<string, string | undefined>> {
  return {
    starter: {
      month: stripeVar("STRIPE_STARTER_MONTHLY_PRICE_ID"),
      year: stripeVar("STRIPE_STARTER_ANNUAL_PRICE_ID"),
    },
    pro: {
      month: stripeVar("STRIPE_PRO_MONTHLY_PRICE_ID"),
      year: stripeVar("STRIPE_PRO_ANNUAL_PRICE_ID"),
    },
  };
}

/** Product ID -> plan mapping, including configured legacy/duplicate products. */
export function buildPlanConfig(): Record<string, PlanConfig> {
  const config: Record<string, PlanConfig> = {};
  const add = (id: string | undefined, plan: string, diagramLimit: number) => {
    if (!id) return;
    if (config[id]) return; // never create a duplicate mapping for the same product
    config[id] = { plan, diagramLimit };
  };

  add(stripeVar("STRIPE_STARTER_PRODUCT_ID"), "starter", PLAN_DIAGRAM_LIMITS.starter);
  add(stripeVar("STRIPE_PRO_PRODUCT_ID"), "pro", PLAN_DIAGRAM_LIMITS.pro);
  for (const id of parseIdList("STRIPE_STARTER_LEGACY_PRODUCT_IDS")) {
    add(id, "starter", PLAN_DIAGRAM_LIMITS.starter);
  }
  for (const id of parseIdList("STRIPE_PRO_LEGACY_PRODUCT_IDS")) {
    add(id, "pro", PLAN_DIAGRAM_LIMITS.pro);
  }

  return config;
}

/**
 * Strictly resolve a subscription to a configured plan. Throws when the product
 * or price is not explicitly configured — never falls back to another plan.
 */
export function resolvePlanFromSubscription(
  subscription: Stripe.Subscription,
  logPrefix = "stripe",
): PlanConfig {
  const planConfig = buildPlanConfig();
  const productId = subscription.items?.data?.[0]?.price?.product as string | undefined;
  const priceId = subscription.items?.data?.[0]?.price?.id as string | undefined;

  if (!productId || !planConfig[productId]) {
    console.error(
      `[${logPrefix}] Unknown Stripe product mapping. subscription_id=${subscription.id} product_id=${productId} price_id=${priceId} configured_products=${JSON.stringify(Object.keys(planConfig))}`,
    );
    throw new Error(
      `Unmapped Stripe product ID "${productId}". Configure STRIPE_STARTER_PRODUCT_ID / STRIPE_PRO_PRODUCT_ID to match this product before activating the subscription.`,
    );
  }

  const knownPriceIds = new Set([
    ...(Object.values(buildPriceMap()).flatMap((m) => Object.values(m)).filter(Boolean) as string[]),
    ...legacyPriceIds(),
  ]);
  if (priceId && knownPriceIds.size > 0 && !knownPriceIds.has(priceId)) {
    console.error(
      `[${logPrefix}] Unknown Stripe price ID on subscription ${subscription.id}: price_id=${priceId} known_prices=${JSON.stringify([...knownPriceIds])}`,
    );
    throw new Error(
      `Unmapped Stripe price ID "${priceId}". Configure STRIPE_*_PRICE_ID env vars to match this price before activating the subscription.`,
    );
  }

  return planConfig[productId];
}
