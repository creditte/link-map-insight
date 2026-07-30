import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION, getSubscriptionLifecycle } from "../_shared/stripe-subscription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    month: Deno.env.get("STRIPE_STARTER_MONTHLY_PRICE_ID"),
    year: Deno.env.get("STRIPE_STARTER_ANNUAL_PRICE_ID"),
  },
  pro: {
    month: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
    year: Deno.env.get("STRIPE_PRO_ANNUAL_PRICE_ID"),
  },
};

// Same source of truth as stripe-webhooks: resolve plan + diagram limit from Stripe product ID.
const PLAN_CONFIG: Record<string, { plan: string; diagramLimit: number }> = {};

function parseIdList(name: string): string[] {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function legacyPriceIds(): string[] {
  return parseIdList("STRIPE_LEGACY_PRICE_IDS");
}

function initPlanConfig() {
  const add = (id: string | undefined, plan: string, diagramLimit: number) => {
    if (!id || PLAN_CONFIG[id]) return; // never create a duplicate mapping
    PLAN_CONFIG[id] = { plan, diagramLimit };
  };
  add(Deno.env.get("STRIPE_STARTER_PRODUCT_ID"), "starter", 15);
  add(Deno.env.get("STRIPE_PRO_PRODUCT_ID"), "pro", 50);
  for (const id of parseIdList("STRIPE_STARTER_LEGACY_PRODUCT_IDS")) add(id, "starter", 15);
  for (const id of parseIdList("STRIPE_PRO_LEGACY_PRODUCT_IDS")) add(id, "pro", 50);
}

function resolvePlanFromSubscription(subscription: Stripe.Subscription): { plan: string; diagramLimit: number } {
  const productId = subscription.items?.data?.[0]?.price?.product as string | undefined;
  const priceId = subscription.items?.data?.[0]?.price?.id as string | undefined;
  if (!productId || !PLAN_CONFIG[productId]) {
    const configuredProducts = Object.keys(PLAN_CONFIG);
    console.error(
      `[switch-billing-interval] Unknown Stripe product mapping. subscription_id=${subscription.id} product_id=${productId} price_id=${priceId} configured_products=${JSON.stringify(configuredProducts)}`,
    );
    throw new Error(
      `Unmapped Stripe product ID "${productId}". Configure STRIPE_STARTER_PRODUCT_ID / STRIPE_PRO_PRODUCT_ID to match this product before switching billing intervals.`,
    );
  }
  const knownPriceIds = new Set(
    Object.values(PRICE_MAP).flatMap((m) => Object.values(m)).filter(Boolean) as string[],
  );
  if (priceId && knownPriceIds.size > 0 && !knownPriceIds.has(priceId)) {
    console.error(
      `[switch-billing-interval] Unknown Stripe price ID on subscription ${subscription.id}: price_id=${priceId} known_prices=${JSON.stringify([...knownPriceIds])}`,
    );
    throw new Error(
      `Unmapped Stripe price ID "${priceId}". Configure STRIPE_*_PRICE_ID env vars to match this price before switching billing intervals.`,
    );
  }
  return PLAN_CONFIG[productId];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    initPlanConfig();

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    // Owner-only check
    const { data: tenantUser } = await supabaseAdmin
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", profile.tenant_id)
      .eq("auth_user_id", userData.user.id)
      .eq("status", "active")
      .single();
    if (!tenantUser || tenantUser.role !== "owner") {
      throw new Error("Only the firm owner can change billing settings");
    }

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, stripe_subscription_id, subscription_status, subscription_plan")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    if (tenant.subscription_status !== "active") {
      throw new Error("Billing interval can only be changed on active subscriptions");
    }
    if (!tenant.stripe_subscription_id) {
      throw new Error("No Stripe subscription found");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

    // Retrieve current subscription
    const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
    const currentItem = subscription.items.data[0];
    if (!currentItem) throw new Error("No subscription item found");

    // Resolve the current plan from the Stripe subscription itself — no fallback to the tenant column or "pro".
    const { plan: currentPlan } = resolvePlanFromSubscription(subscription);

    const currentInterval = currentItem.price.recurring?.interval;
    if (currentInterval !== "month" && currentInterval !== "year") {
      throw new Error(`Unsupported current billing interval: ${currentInterval}`);
    }
    const targetInterval: "month" | "year" = currentInterval === "month" ? "year" : "month";

    // Find the target price ID — must exist in the configured mapping for this plan.
    const targetPriceId = PRICE_MAP[currentPlan]?.[targetInterval];
    if (!targetPriceId) {
      console.error(
        `[switch-billing-interval] No configured price for plan=${currentPlan} interval=${targetInterval}`,
      );
      throw new Error(`No Stripe price configured for plan '${currentPlan}' with interval '${targetInterval}'.`);
    }

    // Update subscription: replace current item with new price
    const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
      items: [
        { id: currentItem.id, price: targetPriceId },
      ],
      proration_behavior: "create_prorations",
    });

    // Derive plan + diagram limit strictly from the updated Stripe subscription — no hardcoded values.
    const { plan: resolvedPlan, diagramLimit: newLimit } = resolvePlanFromSubscription(updatedSub);

    const updatedLife = getSubscriptionLifecycle(updatedSub);

    // Update tenant record
    const updatePayload: Record<string, any> = {
      subscription_plan: resolvedPlan,
      diagram_limit: newLimit,
    };
    if (updatedLife.currentPeriodStart) updatePayload.current_period_start = updatedLife.currentPeriodStart;
    if (updatedLife.currentPeriodEnd) updatePayload.current_period_end = updatedLife.currentPeriodEnd;
    if (updatedLife.trialEnd) updatePayload.trial_ends_at = updatedLife.trialEnd;
    updatePayload.cancel_at_period_end = updatedLife.cancelAtPeriodEnd;

    await supabaseAdmin.from("tenants").update(updatePayload).eq("id", tenant.id);

    const newPrice = updatedSub.items.data[0]?.price;

    return new Response(JSON.stringify({
      success: true,
      plan: resolvedPlan,
      diagram_limit: newLimit,
      new_interval: updatedLife.interval || newPrice?.recurring?.interval || targetInterval,
      new_price_amount: updatedLife.priceAmount ?? newPrice?.unit_amount ?? null,
      current_period_end: updatedLife.currentPeriodEnd,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("switch-billing-interval error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
