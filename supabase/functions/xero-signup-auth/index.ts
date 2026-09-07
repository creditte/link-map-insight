import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Xero not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let firmName = "";
    let selectedPlan = "pro";
    let selectedBilling = "monthly";
    let callerOrigin: string | undefined;
    let connectionType = "accounting";

    try {
      const body = await req.json();
      firmName = typeof body.firmName === "string" ? body.firmName.trim() : "";
      callerOrigin = typeof body.origin === "string" ? body.origin : undefined;
      if (body.connection_type === "practice_manager") connectionType = "practice_manager";
      const plan = body.selectedPlan;
      const billing = body.selectedBilling;
      if (plan && ["starter", "pro", "enterprise"].includes(plan)) selectedPlan = plan;
      if (billing && ["monthly", "annual"].includes(billing)) selectedBilling = billing;
    } catch {
      /* no body */
    }

    if (!firmName) {
      return new Response(JSON.stringify({ error: "Firm name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-signup-callback`;
    const csrfToken = crypto.randomUUID();
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: insertErr } = await serviceClient.from("xero_oauth_states").insert({
      flow: "signup",
      csrf_token: csrfToken,
      pending_signup: {
        firm_name: firmName,
        selected_plan: selectedPlan,
        selected_billing: selectedBilling,
        connection_type: connectionType,
      },
    });

    if (insertErr) {
      console.error("[xero-signup-auth] insert state failed:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to start signup" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const frontendOrigin = callerOrigin ||
      Deno.env.get("FRONTEND_URL") ||
      "https://strukcha-dev.lovable.app";

    const state = btoa(JSON.stringify({
      csrf: csrfToken,
      origin: frontendOrigin,
      flow: "signup",
    }));

    const scopes = connectionType === "practice_manager"
      ? "openid profile email offline_access practicemanager.client.read"
      : "openid profile email offline_access accounting.contacts.read";

    const authUrl =
      `https://login.xero.com/identity/connect/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${encodeURIComponent(state)}`;

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("xero-signup-auth error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
