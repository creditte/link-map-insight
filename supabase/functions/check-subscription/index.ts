import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, selected_billing")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("subscription_status, subscription_plan, selected_plan, access_enabled, access_locked_reason, trial_ends_at, current_period_end, diagram_limit, diagram_count, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, trial_used_at")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    // Mark expired trials and lock access (no subscription = must subscribe)
    if (
      tenant.subscription_status === "trialing" &&
      tenant.trial_ends_at &&
      new Date(tenant.trial_ends_at) < new Date()
    ) {
      await supabaseAdmin
        .from("tenants")
        .update({
          subscription_status: "trial_expired",
          access_enabled: false,
          access_locked_reason: "trial_expired",
        })
        .eq("id", profile.tenant_id);

      tenant.subscription_status = "trial_expired";
      tenant.access_enabled = false;
      tenant.access_locked_reason = "trial_expired";
    }

    // Determine billing interval from Stripe subscription if available, otherwise fall back to the user's chosen billing cycle
    let billing_interval: string | null = profile.selected_billing === "annual" ? "year" : "month";
    let price_amount: number | null = null;
    if (tenant.stripe_subscription_id) {
      try {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
          const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
          const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
          const priceData = sub.items?.data?.[0]?.price;
          if (priceData) {
            billing_interval = priceData.recurring?.interval || null;
            price_amount = priceData.unit_amount || null;
          }

          // If Stripe subscription is not actually active/trialing, reflect that in app state
          if (!["active", "trialing"].includes(sub.status) && tenant.subscription_status !== "trial_expired") {
            tenant.subscription_status = sub.status;
            tenant.access_enabled = false;
            tenant.access_locked_reason = sub.status === "canceled" ? "subscription_canceled" : `subscription_${sub.status}`;

            // Persist bad status to DB so it's not re-queried every time
            await supabaseAdmin.from("tenants").update({
              subscription_status: sub.status,
              access_enabled: false,
              access_locked_reason: tenant.access_locked_reason,
            }).eq("id", profile.tenant_id);
            console.log(`[check-subscription] Synced bad status to DB: ${sub.status}`);
          }

          // If Stripe subscription IS active/trialing but DB disagrees, self-heal
          if (["active", "trialing"].includes(sub.status) && !["active", "trialing"].includes(tenant.subscription_status)) {
            const productId = priceData?.product as string | undefined;
            const starterProductId = Deno.env.get("STRIPE_STARTER_PRODUCT_ID");
            let resolvedPlan = "pro";
            if (productId && starterProductId && productId === starterProductId) {
              resolvedPlan = "starter";
            }

            // Determine limit based on status + plan
            let resolvedLimit = 3; // default for trialing
            if (sub.status === "active") {
              resolvedLimit = resolvedPlan === "starter" ? 15 : 50;
            }

            const healUpdate: Record<string, any> = {
              subscription_status: sub.status,
              subscription_plan: resolvedPlan,
              access_enabled: true,
              access_locked_reason: null,
              diagram_limit: resolvedLimit,
              stripe_subscription_id: sub.id,
              current_period_start: sub.current_period_start
                ? new Date(sub.current_period_start * 1000).toISOString()
                : null,
              current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
            };

            await supabaseAdmin.from("tenants").update(healUpdate).eq("id", profile.tenant_id);
            console.log(`[check-subscription] Self-healed tenant: ${tenant.subscription_status} → ${sub.status}`);

            tenant.subscription_status = sub.status;
            tenant.subscription_plan = resolvedPlan;
            tenant.access_enabled = true;
            tenant.access_locked_reason = null;
            tenant.diagram_limit = resolvedLimit;
            tenant.cancel_at_period_end = sub.cancel_at_period_end ?? false;
            tenant.current_period_end = healUpdate.current_period_end;
          }
        }
      } catch (e) {
        console.error("[check-subscription] Error fetching Stripe sub:", e);
      }
    }

    // Determine effective diagram_limit based on subscription_status
    let effectiveDiagramLimit = 3; // default for trialing, trial_expired, canceled
    if (["active", "past_due"].includes(tenant.subscription_status)) {
      effectiveDiagramLimit = tenant.subscription_plan === "starter" ? 15 : 50;
    }

    // Persist corrected limit to DB if it differs
    if (effectiveDiagramLimit !== tenant.diagram_limit) {
      await supabaseAdmin
        .from("tenants")
        .update({ diagram_limit: effectiveDiagramLimit })
        .eq("id", profile.tenant_id);
      tenant.diagram_limit = effectiveDiagramLimit;
    }

    const hasPendingDowngrade = tenant.selected_plan && tenant.selected_plan !== tenant.subscription_plan;

    return new Response(JSON.stringify({
      subscription_status: tenant.subscription_status,
      subscription_plan: tenant.subscription_plan,
      selected_plan: tenant.selected_plan,
      pending_downgrade: hasPendingDowngrade ? tenant.selected_plan : null,
      access_enabled: tenant.access_enabled,
      access_locked_reason: tenant.access_locked_reason,
      trial_ends_at: tenant.trial_ends_at,
      current_period_end: tenant.current_period_end,
      diagram_limit: effectiveDiagramLimit,
      diagram_count: tenant.diagram_count,
      cancel_at_period_end: tenant.cancel_at_period_end,
      stripe_customer_id: tenant.stripe_customer_id,
      trial_used_at: tenant.trial_used_at,
      billing_interval,
      price_amount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
