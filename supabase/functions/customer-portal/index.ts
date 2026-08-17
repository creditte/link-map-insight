import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { stripeVar } from "../_shared/stripe-env.ts";

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

const PORTAL_CONFIG_VERSION = "strukcha-portal-v1";

/**
 * Ensures a Stripe Customer Portal configuration exists with subscription updates
 * (plan switching + billing interval switching) enabled for our configured products.
 * Reuses/updates the configuration tagged with our metadata marker so we never create duplicates.
 */
async function ensurePortalConfiguration(stripe: Stripe): Promise<string | undefined> {
  // Build the list of switchable products from configured env vars only — no fallbacks.
  const products: { product: string; prices: string[] }[] = [];
  const addProduct = (productId: string | undefined, prices: (string | undefined)[]) => {
    const validPrices = prices.filter(Boolean) as string[];
    if (!productId || validPrices.length === 0) return;
    if (products.some((p) => p.product === productId)) return;
    products.push({ product: productId, prices: validPrices });
  };
  addProduct(stripeVar("STRIPE_STARTER_PRODUCT_ID"), [
    PRICE_MAP.starter.monthly,
    PRICE_MAP.starter.annual,
  ]);
  addProduct(stripeVar("STRIPE_PRO_PRODUCT_ID"), [
    PRICE_MAP.pro.monthly,
    PRICE_MAP.pro.annual,
  ]);

  if (products.length === 0) {
    console.warn("[customer-portal] No configured products/prices — using Stripe default portal configuration");
    return undefined;
  }

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["name", "email", "address", "phone"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price", "promotion_code"],
      proration_behavior: "create_prorations",
      products,
    },
  };

  // Reuse an existing managed configuration if present
  const existing = await stripe.billingPortal.configurations.list({ limit: 100, active: true });
  const managed = existing.data.find((c) => c.metadata?.managed_by === PORTAL_CONFIG_VERSION);

  if (managed) {
    const updated = await stripe.billingPortal.configurations.update(managed.id, { features });
    console.log("[customer-portal] Updated managed portal configuration", updated.id);
    return updated.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    features,
    business_profile: {},
    metadata: { managed_by: PORTAL_CONFIG_VERSION },
  });
  console.log("[customer-portal] Created managed portal configuration", created.id);
  return created.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
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

    // Owner-only check
    const { data: tenantUser } = await supabaseAdmin
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", profile.tenant_id)
      .eq("auth_user_id", userData.user.id)
      .eq("status", "active")
      .single();
    if (!tenantUser || tenantUser.role !== "owner") {
      throw new Error("Only the firm owner can access the billing portal");
    }

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, stripe_customer_id, stripe_subscription_id, stripe_mode, subscription_status")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
    const origin = req.headers.get("origin") || Deno.env.get("FRONTEND_URL") || "https://strukcha.app";

    // Stripe IDs from another mode (legacy sandbox data) cannot be opened with the
    // active key — quarantine them and fall through to a fresh checkout instead of
    // failing with "No such customer".
    let refs = tenantStripeRefs(tenant);
    const legacyQuarantined = refs.isLegacy;
    if (refs.isLegacy) {
      await quarantineLegacyStripeRefs(supabaseAdmin, tenant, "customer-portal");
      refs = tenantStripeRefs(tenant);
    }

    // Ensure Stripe customer exists in the ACTIVE mode
    let customerId = refs.customerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { workspace_id: tenant.id, owner_user_id: userData.user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("tenants")
        .update({ stripe_customer_id: customerId, stripe_mode: stripeMode() })
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
      // Has an active subscription → open the customer portal for management.
      // Ensure the portal allows plan + billing interval changes.
      let configurationId: string | undefined;
      try {
        configurationId = await ensurePortalConfiguration(stripe);
      } catch (cfgErr: any) {
        console.error("[customer-portal] Failed to ensure portal configuration:", cfgErr?.message ?? cfgErr);
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/settings`,
        ...(configurationId ? { configuration: configurationId } : {}),
      });
      return new Response(JSON.stringify({ url: portalSession.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No active subscription → create a Checkout session to start one
    console.log("[customer-portal] No active subscription found, redirecting to checkout");

    const selectedPlan = profile.selected_plan;
    const selectedBilling = profile.selected_billing;
    if (!selectedPlan || !selectedBilling) {
      console.error("[customer-portal] Missing plan/billing selection", { tenant_id: profile.tenant_id, selectedPlan, selectedBilling });
      return new Response(JSON.stringify({ error: "No plan selected. Please choose a plan before starting checkout." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const planPrices = PRICE_MAP[selectedPlan];
    if (!planPrices) {
      console.error("[customer-portal] Unknown plan", { tenant_id: profile.tenant_id, selectedPlan });
      return new Response(JSON.stringify({ error: `Unknown plan: ${selectedPlan}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const priceId = planPrices[selectedBilling];
    if (!priceId) {
      console.error("[customer-portal] Unknown/unconfigured billing interval", { tenant_id: profile.tenant_id, selectedPlan, selectedBilling });
      return new Response(JSON.stringify({ error: `No Stripe price configured for plan '${selectedPlan}' with billing interval '${selectedBilling}'.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
