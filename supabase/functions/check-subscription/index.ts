import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { STRIPE_API_VERSION, getSubscriptionLifecycle } from "../_shared/stripe-subscription.ts";
import { stripeVar } from "../_shared/stripe-env.ts";

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
      .select("id, subscription_status, subscription_plan, selected_plan, access_enabled, access_locked_reason, trial_ends_at, current_period_end, diagram_limit, diagram_count, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_mode, trial_used_at, last_plan_switch_at, payment_method_captured")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    // Stripe references saved in a different Stripe mode (legacy sandbox data while
    // the app now runs live) cannot be read with the active key. Quarantine them so
    // no Stripe call is made with an ID that does not exist in this environment.
    let refs = tenantStripeRefs(tenant);
    let legacyStripeData = refs.isLegacy;
    if (refs.isLegacy) {
      await quarantineLegacyStripeRefs(supabaseAdmin, tenant, "check-subscription");
      refs = tenantStripeRefs(tenant);
    }

    // Mark expired trials and lock access (no subscription = must subscribe)
    if (
      tenant.subscription_status === "trialing" &&
      !refs.subscriptionId &&
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
    if (refs.subscriptionId) {
      try {
        const stripeKey = stripeVar("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
          const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
          const sub = await stripe.subscriptions.retrieve(refs.subscriptionId);

          const life = getSubscriptionLifecycle(sub);
          const priceData = sub.items?.data?.[0]?.price;
          if (life.interval) billing_interval = life.interval;
          if (life.priceAmount !== null) price_amount = life.priceAmount;

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
            const parseIdList = (name: string) =>
              (Deno.env.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            const starterProductIds = [
              stripeVar("STRIPE_STARTER_PRODUCT_ID"),
              ...parseIdList("STRIPE_STARTER_LEGACY_PRODUCT_IDS"),
            ].filter(Boolean) as string[];
            const proProductIds = [
              stripeVar("STRIPE_PRO_PRODUCT_ID"),
              ...parseIdList("STRIPE_PRO_LEGACY_PRODUCT_IDS"),
            ].filter(Boolean) as string[];

            let resolvedPlan: string | null = null;
            let resolvedLimit: number | null = null;
            if (productId && starterProductIds.includes(productId)) {
              resolvedPlan = "starter";
              resolvedLimit = 15;
            } else if (productId && proProductIds.includes(productId)) {
              resolvedPlan = "pro";
              resolvedLimit = 50;
            }


            if (!resolvedPlan || resolvedLimit === null) {
              // Refuse to self-heal with an unknown Stripe product — do NOT grant any plan benefits.
              console.error(
                `[check-subscription] Refusing to self-heal tenant ${profile.tenant_id}: unmapped Stripe product ${productId} on subscription ${sub.id}. Configure STRIPE_STARTER_PRODUCT_ID / STRIPE_PRO_PRODUCT_ID.`,
              );
              throw new Error(
                `Unmapped Stripe product "${productId}" on active subscription. Cannot activate access without a resolved plan mapping.`,
              );
            }

            const healUpdate: Record<string, any> = {
              subscription_status: sub.status,
              subscription_plan: resolvedPlan,
              access_enabled: true,
              access_locked_reason: null,
              diagram_limit: resolvedLimit,
              stripe_subscription_id: sub.id,
              current_period_start: life.currentPeriodStart,
              current_period_end: life.currentPeriodEnd,
              cancel_at_period_end: life.cancelAtPeriodEnd,
            };
            if (life.trialEnd) healUpdate.trial_ends_at = life.trialEnd;

            await supabaseAdmin.from("tenants").update(healUpdate).eq("id", profile.tenant_id);
            console.log(`[check-subscription] Self-healed tenant: ${tenant.subscription_status} → ${sub.status}`);

            tenant.subscription_status = sub.status;
            tenant.subscription_plan = resolvedPlan;
            tenant.access_enabled = true;
            tenant.access_locked_reason = null;
            tenant.diagram_limit = resolvedLimit;
            tenant.cancel_at_period_end = life.cancelAtPeriodEnd;
            tenant.current_period_end = healUpdate.current_period_end;
          } else if (["active", "trialing"].includes(sub.status)) {
            // Always sync current_period_end from Stripe even when statuses match
            const stripePeriodEnd = life.currentPeriodEnd;
            const stripePeriodStart = life.currentPeriodStart;

            const drift: Record<string, any> = {};
            if (stripePeriodEnd && stripePeriodEnd !== tenant.current_period_end) {
              drift.current_period_end = stripePeriodEnd;
              if (stripePeriodStart) drift.current_period_start = stripePeriodStart;
            }
            if (life.cancelAtPeriodEnd !== tenant.cancel_at_period_end) {
              drift.cancel_at_period_end = life.cancelAtPeriodEnd;
            }
            if (life.trialEnd && life.trialEnd !== tenant.trial_ends_at) {
              drift.trial_ends_at = life.trialEnd;
            }
            if (Object.keys(drift).length > 0) {
              await supabaseAdmin.from("tenants").update(drift).eq("id", profile.tenant_id);
              if (drift.current_period_end) tenant.current_period_end = drift.current_period_end;
              if ("cancel_at_period_end" in drift) tenant.cancel_at_period_end = drift.cancel_at_period_end;
              if (drift.trial_ends_at) tenant.trial_ends_at = drift.trial_ends_at;
            }
          }
        }
      } catch (e) {
        console.error("[check-subscription] Error fetching Stripe sub:", e);
      }
    }

    // Determine effective diagram_limit strictly from subscription_plan; never fall back to a Pro-sized limit.
    // Trials always get the 3-group trial allowance (full Pro features, capped volume), whether the
    // trial is Stripe-managed or self-serve. Plan limits only apply once the subscription is paying.
    const TRIAL_GROUP_LIMIT = 3;
    let effectiveDiagramLimit = TRIAL_GROUP_LIMIT; // trialing, trial_expired, canceled
    if (["active", "past_due"].includes(tenant.subscription_status)) {

      if (tenant.subscription_plan === "starter") {
        effectiveDiagramLimit = 15;
      } else if (tenant.subscription_plan === "pro") {
        effectiveDiagramLimit = 50;
      } else {
        console.error(
          `[check-subscription] Tenant ${profile.tenant_id} is ${tenant.subscription_status} with unmapped subscription_plan="${tenant.subscription_plan}". Refusing to grant a plan limit.`,
        );
        throw new Error(
          `Unmapped subscription plan "${tenant.subscription_plan}" for active tenant. Cannot determine diagram limit.`,
        );
      }
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

    // Central kill-switch: when billing enforcement is disabled, expose access as enabled
    // and remove the diagram cap so every frontend path skips gating uniformly.
    const { data: flagRow } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "billing_enforcement_enabled")
      .maybeSingle();
    const enforcementEnabled = flagRow?.value === true;

    const effectiveAccessEnabled = enforcementEnabled ? tenant.access_enabled : true;
    const effectiveAccessLockedReason = enforcementEnabled ? tenant.access_locked_reason : null;
    const exposedDiagramLimit = enforcementEnabled ? effectiveDiagramLimit : Number.MAX_SAFE_INTEGER;

    // Mandatory payment-method capture during registration is enforced
    // independently of the billing enforcement kill-switch.
    const paymentMethodRequired =
      tenant.payment_method_captured !== true && !tenant.stripe_subscription_id;

    return new Response(JSON.stringify({
      enforcement_enabled: enforcementEnabled,
      payment_method_required: paymentMethodRequired,
      payment_method_captured: tenant.payment_method_captured === true,
      subscription_status: tenant.subscription_status,
      subscription_plan: tenant.subscription_plan,
      selected_plan: tenant.selected_plan,
      pending_downgrade: hasPendingDowngrade ? tenant.selected_plan : null,
      access_enabled: effectiveAccessEnabled,
      access_locked_reason: effectiveAccessLockedReason,
      trial_ends_at: tenant.trial_ends_at,
      current_period_end: tenant.current_period_end,
      diagram_limit: exposedDiagramLimit,
      diagram_count: tenant.diagram_count,
      cancel_at_period_end: tenant.cancel_at_period_end,
      stripe_customer_id: tenant.stripe_customer_id,
      trial_used_at: tenant.trial_used_at,
      billing_interval,
      price_amount,
      last_plan_switch_at: tenant.last_plan_switch_at,
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
