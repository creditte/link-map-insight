import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    monthly: Deno.env.get("STRIPE_STARTER_MONTHLY_PRICE_ID"),
    annual: Deno.env.get("STRIPE_STARTER_ANNUAL_PRICE_ID"),
  },
  pro: {
    monthly: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
    annual: Deno.env.get("STRIPE_PRO_ANNUAL_PRICE_ID"),
  },
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, selected_plan, selected_billing")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, stripe_customer_id, subscription_status")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || Deno.env.get("FRONTEND_URL") || "https://strukcha.app";

    // Ensure Stripe customer exists
    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { workspace_id: tenant.id, owner_user_id: userData.user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id);
    }

    // Check if the customer has an active/trialing subscription in Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    const trialingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "trialing",
      limit: 1,
    });

    const hasActiveSubscription = subscriptions.data.length > 0 || trialingSubs.data.length > 0;

    if (hasActiveSubscription) {
      // Has an active subscription → open the customer portal for management
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/settings`,
      });
      return new Response(JSON.stringify({ url: portalSession.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No active subscription → create a Checkout session to start one
    console.log("[customer-portal] No active subscription found, redirecting to checkout");

    const selectedPlan = profile.selected_plan || "pro";
    const selectedBilling = profile.selected_billing || "monthly";
    const planPrices = PRICE_MAP[selectedPlan] || PRICE_MAP.pro;
    const priceId = planPrices?.[selectedBilling] || planPrices?.monthly;
    if (!priceId) throw new Error(`No Stripe price configured for plan: ${selectedPlan}, billing: ${selectedBilling}`);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings`,
      metadata: { workspace_id: tenant.id, owner_user_id: userData.user.id },
      subscription_data: {
        metadata: { workspace_id: tenant.id },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[customer-portal] error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
