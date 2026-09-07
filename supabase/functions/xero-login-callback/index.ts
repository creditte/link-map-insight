import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken } from "../_shared/crypto.ts";
import { verifyXeroIdToken } from "../_shared/verify-xero-id-token.ts";

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email?: string } | null> {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === normalized);
    if (u) return { id: u.id, email: u.email };
    if (data.users.length < perPage) return null;
    page++;
  }
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    const defaultFrontendUrl = Deno.env.get("FRONTEND_URL") || "https://strukcha-dev.lovable.app";

    if (oauthError) {
      console.error("Xero OAuth error:", oauthError);
      return Response.redirect(
        `${defaultFrontendUrl}/login?xero_login=error&reason=${encodeURIComponent(oauthError)}`,
        302,
      );
    }

    if (!code || !stateParam) {
      return Response.redirect(`${defaultFrontendUrl}/login?xero_login=error&reason=missing_params`, 302);
    }

    let csrfToken: string;
    let frontendUrl: string;
    try {
      const state = JSON.parse(atob(decodeURIComponent(stateParam)));
      csrfToken = state.csrf;
      frontendUrl = state.origin || defaultFrontendUrl;
      if (state.flow !== "login") {
        return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=invalid_flow`, 302);
      }
    } catch {
      return Response.redirect(`${defaultFrontendUrl}/login?xero_login=error&reason=invalid_state`, 302);
    }

    if (!csrfToken) {
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=missing_csrf`, 302);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: csrfRecord, error: csrfError } = await supabase
      .from("xero_oauth_states")
      .select("id, created_at")
      .eq("csrf_token", csrfToken)
      .eq("flow", "login")
      .is("user_id", null)
      .eq("used", false)
      .maybeSingle();

    if (csrfError || !csrfRecord) {
      console.error("[xero-login-callback] CSRF validation failed:", csrfError);
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=invalid_csrf`, 302);
    }

    const tokenAge = Date.now() - new Date(csrfRecord.created_at).getTime();
    if (tokenAge > 10 * 60 * 1000) {
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=expired_csrf`, 302);
    }

    await supabase.from("xero_oauth_states").update({ used: true }).eq("id", csrfRecord.id);

    const clientId = Deno.env.get("XERO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-login-callback`;

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
      console.error("[xero-login-callback] Token exchange failed:", errBody);
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=token_exchange_failed`, 302);
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    if (!tokens.id_token) {
      console.error("[xero-login-callback] Missing id_token");
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=no_id_token`, 302);
    }

    let idPayload;
    try {
      idPayload = await verifyXeroIdToken(tokens.id_token, clientId);
    } catch (e) {
      console.error("[xero-login-callback] id_token verify failed:", e);
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=invalid_id_token`, 302);
    }

    const emailRaw = idPayload.email;
    if (!emailRaw || typeof emailRaw !== "string") {
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=no_email`, 302);
    }
    const email = emailRaw.toLowerCase().trim();

    const existing = await findAuthUserByEmail(supabase, email);
    if (!existing) {
      return Response.redirect(`${frontendUrl}/login?xero_login=no_account`, 302);
    }

    const userId = existing.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile?.tenant_id) {
      return Response.redirect(`${frontendUrl}/login?xero_login=error&reason=no_profile`, 302);
    }

    if (tokens.refresh_token) {
      const connectionsRes = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      let xeroTenantId: string | null = null;
      let xeroOrgName: string | null = null;
      if (connectionsRes.ok) {
        const connections = await connectionsRes.json() as Array<{ tenantId?: string; tenantName?: string }>;
        if (connections.length > 0) {
          xeroTenantId = connections[0].tenantId ?? null;
          xeroOrgName = connections[0].tenantName ?? null;
        }
      }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const encryptedAccessToken = await encryptToken(tokens.access_token);
      const encryptedRefreshToken = await encryptToken(tokens.refresh_token);
      const { error: xcError } = await supabase.from("xero_connections").upsert(
        {
          user_id: userId,
          tenant_id: String(profile.tenant_id),
          xero_tenant_id: xeroTenantId,
          xero_org_name: xeroOrgName,
          connected_by_email: email,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tenant_id" },
      );
      if (xcError) console.error("[xero-login-callback] xero_connections:", xcError);
    }

    await supabase.from("xero_oauth_states").delete().eq("id", csrfRecord.id);

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${frontendUrl}/` },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[xero-login-callback] generateLink:", linkError);
      return Response.redirect(
        `${frontendUrl}/login?xero_login=magiclink_failed&email=${encodeURIComponent(email)}`,
        302,
      );
    }

    return Response.redirect(linkData.properties.action_link, 302);
  } catch (err) {
    console.error("xero-login-callback error:", err);
    const fallback = Deno.env.get("FRONTEND_URL") || "https://strukcha-dev.lovable.app";
    return Response.redirect(`${fallback}/login?xero_login=error&reason=server_error`, 302);
  }
});
