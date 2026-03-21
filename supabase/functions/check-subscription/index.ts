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
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();
    if (!profile) throw new Error("No profile found");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("subscription_status, subscription_plan, access_enabled, access_locked_reason, trial_ends_at, current_period_end, diagram_limit, diagram_count, cancel_at_period_end, stripe_customer_id, trial_used_at")
      .eq("id", profile.tenant_id)
      .single();
    if (!tenant) throw new Error("No tenant found");

    return new Response(JSON.stringify({
      subscription_status: tenant.subscription_status,
      subscription_plan: tenant.subscription_plan,
      access_enabled: tenant.access_enabled,
      access_locked_reason: tenant.access_locked_reason,
      trial_ends_at: tenant.trial_ends_at,
      current_period_end: tenant.current_period_end,
      diagram_limit: tenant.diagram_limit,
      diagram_count: tenant.diagram_count,
      cancel_at_period_end: tenant.cancel_at_period_end,
      stripe_customer_id: tenant.stripe_customer_id,
      trial_used_at: tenant.trial_used_at,
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
