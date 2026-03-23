import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("stripe_customer_id, subscription_status")
      .eq("id", profile.tenant_id)
      .single();

    if (!tenant?.stripe_customer_id) {
      // No Stripe customer yet — create one and redirect to checkout instead
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { workspace_id: profile.tenant_id, owner_user_id: userData.user.id },
      });

      await supabaseAdmin
        .from("tenants")
        .update({ stripe_customer_id: customer.id })
        .eq("id", profile.tenant_id);

      const origin = req.headers.get("origin") || Deno.env.get("FRONTEND_URL") || "https://strukcha.app";
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${origin}/settings`,
      });

      return new Response(JSON.stringify({ url: portalSession.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || Deno.env.get("FRONTEND_URL") || "https://strukcha.app";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${origin}/settings`,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
