import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Xero not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-callback`;

    // Parse request body to get the caller's origin and connection type
    let callerOrigin: string | undefined;
    let connectionType: string = "accounting"; // default
    try {
      const body = await req.json();
      callerOrigin = body.origin;
      if (body.connection_type === "practice_manager") {
        connectionType = "practice_manager";
      }
    } catch { /* no body */ }

    // Generate CSRF token and store it server-side
    const csrfToken = crypto.randomUUID();
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await serviceClient.from("xero_oauth_states").insert({
      user_id: claimsData.claims.sub,
      csrf_token: csrfToken,
    });

    // Select scopes based on connection type
    const scopes = connectionType === "practice_manager"
      ? "openid profile email offline_access practicemanager.client.read"
      : "openid profile email offline_access accounting.contacts.read";

    // Store user_id, origin, connection type, and CSRF token in state
    const state = btoa(JSON.stringify({
      user_id: claimsData.claims.sub,
      origin: callerOrigin || Deno.env.get("FRONTEND_URL") || "https://link-map-insight.lovable.app",
      csrf: csrfToken,
      connection_type: connectionType,
    }));

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
    console.error("xero-auth error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
