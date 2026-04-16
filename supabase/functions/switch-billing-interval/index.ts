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

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve current subscription
    const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
    const currentItem = subscription.items.data[0];
    if (!currentItem) throw new Error("No subscription item found");

    const currentInterval = currentItem.price.recurring?.interval;
    const targetInterval = currentInterval === "month" ? "year" : "month";

    // Find the target price ID
    const plan = tenant.subscription_plan || "pro";
    const targetPriceId = PRICE_MAP[plan]?.[targetInterval];
    if (!targetPriceId) {
      throw new Error(`No price configured for plan: ${plan}, interval: ${targetInterval}`);
    }

    // Update subscription: replace current item with new price
    const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
      items: [
        { id: currentItem.id, price: targetPriceId },
      ],
      proration_behavior: "create_prorations",
    });

    // Determine new limit based on plan
    const newLimit = plan === "starter" ? 15 : 50;

    // Safe date conversion: handle both Unix timestamps and ISO strings
    const toISO = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === "number") return new Date(val * 1000).toISOString();
      if (typeof val === "string") return new Date(val).toISOString();
      return null;
    };

    // Update tenant record
    const updatePayload: Record<string, any> = { diagram_limit: newLimit };
    const periodStart = toISO(updatedSub.current_period_start);
    const periodEnd = toISO(updatedSub.current_period_end);
    if (periodStart) updatePayload.current_period_start = periodStart;
    if (periodEnd) updatePayload.current_period_end = periodEnd;

    await supabaseAdmin.from("tenants").update(updatePayload).eq("id", tenant.id);

    const newPrice = updatedSub.items.data[0]?.price;

    return new Response(JSON.stringify({
      success: true,
      new_interval: newPrice?.recurring?.interval || targetInterval,
      new_price_amount: newPrice?.unit_amount || null,
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
