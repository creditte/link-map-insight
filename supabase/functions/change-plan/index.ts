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
      .select("id, stripe_subscription_id, subscription_status, subscription_plan, diagram_count")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    if (tenant.subscription_status !== "active") {
      throw new Error("Plan can only be changed on active subscriptions");
    }
    if (!tenant.stripe_subscription_id) {
      throw new Error("No Stripe subscription found");
    }
    if (tenant.subscription_plan === targetPlan) {
      throw new Error(`You are already on the ${targetPlan} plan`);
    }

    // For downgrade: check if current usage exceeds target limit
    const targetLimit = PLAN_LIMITS[targetPlan];
    if (targetPlan === "starter" && (tenant.diagram_count || 0) > targetLimit) {
      throw new Error(
        `Cannot downgrade to Starter. You have ${tenant.diagram_count} active structures, but Starter allows a maximum of ${targetLimit}. Please archive or delete some structures first.`
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve current subscription to get interval and item
    const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
    const currentItem = subscription.items.data[0];
    if (!currentItem) throw new Error("No subscription item found");

    const currentInterval = currentItem.price.recurring?.interval || "month";

    // Get the target price (same interval, different plan)
    const targetPriceId = PRICE_MAP[targetPlan]?.[currentInterval];
    if (!targetPriceId) {
      throw new Error(`No price configured for plan: ${targetPlan}, interval: ${currentInterval}`);
    }

    const isUpgrade = targetPlan === "pro";

    if (isUpgrade) {
      // Upgrade: apply immediately with proration
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
        subscription_plan: targetPlan,
        diagram_limit: PLAN_LIMITS[targetPlan],
        cancel_at_period_end: false,
        canceled_at: null,
      };
      const periodEnd = toISO(updatedSub.current_period_end);
      if (periodEnd) updatePayload.current_period_end = periodEnd;

      await supabaseAdmin.from("tenants").update(updatePayload).eq("id", tenant.id);

      return new Response(JSON.stringify({
        success: true,
        new_plan: targetPlan,
        effective: "immediate",
        new_limit: PLAN_LIMITS[targetPlan],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // Downgrade: schedule at end of current period
      const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
        items: [{ id: currentItem.id, price: targetPriceId }],
        proration_behavior: "none",
      });

      // Update tenant plan immediately since Stripe applies the change
      await supabaseAdmin.from("tenants").update({
        subscription_plan: targetPlan,
        diagram_limit: PLAN_LIMITS[targetPlan],
        cancel_at_period_end: false,
        canceled_at: null,
      }).eq("id", tenant.id);

      return new Response(JSON.stringify({
        success: true,
        new_plan: targetPlan,
        effective: "immediate",
        new_limit: PLAN_LIMITS[targetPlan],
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
