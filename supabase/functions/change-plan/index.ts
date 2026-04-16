import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

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

const PLAN_LIMITS: Record<string, number> = {
  starter: 15,
  pro: 50,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    // Parse body
    const body = await req.json().catch(() => ({}));
    const targetPlan = body.target_plan;
    if (!targetPlan || !["starter", "pro"].includes(targetPlan)) {
      throw new Error("Invalid target_plan. Must be 'starter' or 'pro'.");
    }

    // Get tenant
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, stripe_subscription_id, subscription_status, subscription_plan, selected_plan, diagram_count, current_period_end, last_plan_switch_at")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    // 24-hour cooldown check
    // TODO: Re-enable cooldown after testing
    // if (tenant.last_plan_switch_at) {
    //   const lastSwitch = new Date(tenant.last_plan_switch_at);
    //   const cooldownEnd = new Date(lastSwitch.getTime() + 24 * 60 * 60 * 1000);
    //   if (new Date() < cooldownEnd) {
    //     throw new Error(`You have recently switched plans. Please wait until ${cooldownEnd.toISOString()} to switch again.`);
    //   }
    // }

    if (tenant.subscription_status !== "active") {
      throw new Error("Plan can only be changed on active subscriptions");
    }
    if (!tenant.stripe_subscription_id) {
      throw new Error("No Stripe subscription found");
    }

    const activePlan = tenant.subscription_plan;
    const pendingPlan = tenant.selected_plan;
    const isUpgrade = targetPlan === "pro";
    const isDowngrade = targetPlan === "starter";

    // Block: already on that plan with no pending change
    if (activePlan === targetPlan && pendingPlan === targetPlan) {
      throw new Error(`You are already on the ${targetPlan} plan`);
    }

    // Block: downgrade already pending
    if (isDowngrade && pendingPlan === "starter" && activePlan === "pro") {
      throw new Error("A downgrade to Starter is already scheduled for the end of your billing period.");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    if (isUpgrade) {
      // ── UPGRADE: starter → pro (or cancel pending downgrade) ──
      // If active plan is already pro but selected_plan was starter (pending downgrade),
      // just clear the pending downgrade without touching Stripe
      if (activePlan === "pro" && pendingPlan === "starter") {
        await supabaseAdmin.from("tenants").update({
          selected_plan: "pro",
          last_plan_switch_at: new Date().toISOString(),
        }).eq("id", tenant.id);

        return new Response(JSON.stringify({
          success: true,
          new_plan: "pro",
          effective: "immediate",
          new_limit: PLAN_LIMITS.pro,
          canceled_downgrade: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Actual upgrade: starter → pro
      const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
      const currentItem = subscription.items.data[0];
      if (!currentItem) throw new Error("No subscription item found");
      const currentInterval = currentItem.price.recurring?.interval || "month";

      const targetPriceId = PRICE_MAP.pro?.[currentInterval];
      if (!targetPriceId) {
        throw new Error(`No price configured for plan: pro, interval: ${currentInterval}`);
      }

      const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
        items: [{ id: currentItem.id, price: targetPriceId }],
        proration_behavior: "create_prorations",
      });

      const toISO = (val: any): string | null => {
        if (!val) return null;
        if (typeof val === "number") return new Date(val * 1000).toISOString();
        if (typeof val === "string") return new Date(val).toISOString();
        return null;
      };

      const updatePayload: Record<string, any> = {
        subscription_plan: "pro",
        selected_plan: "pro",
        diagram_limit: PLAN_LIMITS.pro,
        cancel_at_period_end: false,
        canceled_at: null,
        last_plan_switch_at: new Date().toISOString(),
      };
      const periodEnd = toISO(updatedSub.current_period_end);
      if (periodEnd) updatePayload.current_period_end = periodEnd;

      await supabaseAdmin.from("tenants").update(updatePayload).eq("id", tenant.id);

      return new Response(JSON.stringify({
        success: true,
        new_plan: "pro",
        effective: "immediate",
        new_limit: PLAN_LIMITS.pro,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // ── DOWNGRADE: pro → starter (scheduled at period end) ──

      // Check if current usage exceeds target limit
      const targetLimit = PLAN_LIMITS.starter;
      if ((tenant.diagram_count || 0) > targetLimit) {
        throw new Error(
          `Cannot downgrade to Starter. You have ${tenant.diagram_count} active structures, but Starter allows a maximum of ${targetLimit}. Please archive or delete some structures first.`
        );
      }

      // Do NOT touch Stripe subscription — just record intent in DB
      await supabaseAdmin.from("tenants").update({
        selected_plan: "starter",
        last_plan_switch_at: new Date().toISOString(),
      }).eq("id", tenant.id);

      return new Response(JSON.stringify({
        success: true,
        new_plan: "starter",
        effective: "period_end",
        new_limit: PLAN_LIMITS.starter,
        current_period_end: tenant.current_period_end,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error: any) {
    console.error("change-plan error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
