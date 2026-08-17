import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { stripeVar, stripeMode } from "../_shared/stripe-env.ts";
import { quarantineLegacyStripeRefs, tenantStripeRefs } from "../_shared/stripe-tenant.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    monthly: stripeVar("STRIPE_STARTER_MONTHLY_PRICE_ID"),
    annual: stripeVar("STRIPE_STARTER_ANNUAL_PRICE_ID"),
  },
  pro: {
    monthly: stripeVar("STRIPE_PRO_MONTHLY_PRICE_ID"),
    annual: stripeVar("STRIPE_PRO_ANNUAL_PRICE_ID"),
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
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
    const user = userData.user;

    // Get user's tenant
     const { data: profile } = await supabaseAdmin
       .from("profiles")
       .select("tenant_id, selected_plan, selected_billing")
       .eq("user_id", user.id)
       .single();
     if (!profile) throw new Error("No profile found");

    // Owner-only check
    const { data: tenantUser } = await supabaseAdmin
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", profile.tenant_id)
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .single();
    if (!tenantUser || tenantUser.role !== "owner") {
      throw new Error("Only the firm owner can manage billing");
    }

    const selectedPlan = profile.selected_plan;
    const selectedBilling = profile.selected_billing;
    if (!selectedPlan || !selectedBilling) {
      console.error("[create-checkout] Missing plan/billing selection", { tenant_id: profile.tenant_id, selectedPlan, selectedBilling });
      return new Response(JSON.stringify({ error: "No plan selected. Please choose a plan before checkout." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const planPrices = PRICE_MAP[selectedPlan];
    if (!planPrices) {
      console.error("[create-checkout] Unknown plan", { tenant_id: profile.tenant_id, selectedPlan });
      return new Response(JSON.stringify({ error: `Unknown plan: ${selectedPlan}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const priceId = planPrices[selectedBilling];
    if (!priceId) {
      console.error("[create-checkout] Unknown/unconfigured billing interval", { tenant_id: profile.tenant_id, selectedPlan, selectedBilling });
      return new Response(JSON.stringify({ error: `No Stripe price configured for plan '${selectedPlan}' with billing interval '${selectedBilling}'.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, stripe_customer_id, stripe_subscription_id, subscription_status, trial_used_at, payment_method_captured")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

    // ── Duplicate-subscription protection ─────────────────────────────
    // 1. Check the subscription we already track.
    if (tenant.stripe_subscription_id) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
        if (["active", "trialing", "past_due", "unpaid"].includes(existingSub.status)) {
          return new Response(
            JSON.stringify({
              error: "Workspace already has a subscription. Manage it from the customer portal.",
              already_subscribed: true,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch {
        // Subscription doesn't exist in Stripe, allow checkout
      }
    }

    // Create or retrieve Stripe customer
    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { workspace_id: tenant.id, owner_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id);
    }

    // 2. Authoritative check against Stripe: never create a second subscription
    // for the same customer (e.g. if the DB lost the subscription id).
    const customerSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    const liveSub = customerSubs.data.find((s) =>
      ["active", "trialing", "past_due", "unpaid"].includes(s.status)
    );
    if (liveSub) {
      // Re-link and refuse to create a duplicate.
      await supabaseAdmin
        .from("tenants")
        .update({ stripe_subscription_id: liveSub.id, payment_method_captured: true })
        .eq("id", tenant.id);
      return new Response(
        JSON.stringify({
          error: "Workspace already has a subscription. Manage it from the customer portal.",
          already_subscribed: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The 7-day free trial is granted by Stripe exactly once per workspace.
    const grantTrial = !tenant.trial_used_at && customerSubs.data.length === 0;

    const origin = req.headers.get("origin") || Deno.env.get("FRONTEND_URL") || "https://strukcha.app";

    const sessionParams: any = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      // Always collect and store a card, even when the trial makes the first
      // invoice A$0 — Stripe vaults it and charges it when the trial ends.
      payment_method_collection: "always",
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/complete-setup?checkout=cancelled`,
      metadata: { workspace_id: tenant.id, owner_user_id: user.id },
      subscription_data: {
        metadata: { workspace_id: tenant.id },
        ...(grantTrial
          ? {
              trial_period_days: 7,
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }
          : {}),
      },
    };


    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("create-checkout error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
