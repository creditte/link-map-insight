import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Default frontend URL (will be overridden by state param if available)
    const defaultFrontendUrl = Deno.env.get("FRONTEND_URL") || "https://link-map-insight.lovable.app";

    if (error) {
      console.error("Xero OAuth error:", error);
      return Response.redirect(`${defaultFrontendUrl}/?xero=error&reason=${encodeURIComponent(error)}`, 302);
    }

    if (!code || !stateParam) {
      return Response.redirect(`${defaultFrontendUrl}/?xero=error&reason=missing_params`, 302);
    }

    // Decode state to get user_id and origin
    let userId: string;
    let frontendUrl: string;
    try {
      const state = JSON.parse(atob(decodeURIComponent(stateParam)));
      userId = state.user_id;
      frontendUrl = state.origin || defaultFrontendUrl;
    } catch {
      return Response.redirect(`${defaultFrontendUrl}/?xero=error&reason=invalid_state`, 302);
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("Token exchange failed:", errBody);
      return Response.redirect(`${frontendUrl}/?xero=error&reason=token_exchange_failed`, 302);
    }

    const tokens = await tokenRes.json();

    // Get Xero tenant (organisation) info
    const connectionsRes = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let xeroTenantId = null;
    let xeroOrgName = null;
    if (connectionsRes.ok) {
      const connections = await connectionsRes.json();
      if (connections.length > 0) {
        xeroTenantId = connections[0].tenantId;
        xeroOrgName = connections[0].tenantName || null;
      }
    }

    // Store in database using service role
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user's tenant_id and email from profiles + auth
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .single();

    // Get user email for display
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const connectedByEmail = authUser?.user?.email || null;

    if (!profile) {
      return Response.redirect(`${frontendUrl}/?xero=error&reason=no_profile`, 302);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert connection (one per user per tenant)
    const { error: dbError } = await supabase
      .from("xero_connections")
      .upsert(
        {
          user_id: userId,
          tenant_id: profile.tenant_id,
          xero_tenant_id: xeroTenantId,
          xero_org_name: xeroOrgName,
          connected_by_email: connectedByEmail,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tenant_id" }
      );

    if (dbError) {
      console.error("DB upsert error:", dbError);
      return Response.redirect(`${frontendUrl}/?xero=error&reason=db_error`, 302);
    }

    return Response.redirect(`${frontendUrl}/?xero=connected`, 302);
  } catch (err) {
    console.error("xero-callback error:", err);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://link-map-insight.lovable.app";
    return Response.redirect(`${frontendUrl}/?xero=error&reason=server_error`, 302);
  }
});
