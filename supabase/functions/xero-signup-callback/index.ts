import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { invokeTransactionalEmail } from "../_shared/invoke-transactional-email.ts";
import { verifyXeroIdToken } from "../_shared/verify-xero-id-token.ts";
import { stripeVar, stripeMode } from "../_shared/stripe-env.ts";

type PendingSignup = {
  firm_name: string;
  selected_plan: string;
  selected_billing: string;
  connection_type?: string;
};

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

    const defaultFrontendUrl = Deno.env.get("FRONTEND_URL") || "https://link-map-insight.lovable.app";

    if (oauthError) {
      console.error("Xero OAuth error:", oauthError);
      return Response.redirect(
        `${defaultFrontendUrl}/signup?xero_signup=error&reason=${encodeURIComponent(oauthError)}`,
        302,
      );
    }

    if (!code || !stateParam) {
      return Response.redirect(`${defaultFrontendUrl}/signup?xero_signup=error&reason=missing_params`, 302);
    }

    let csrfToken: string;
    let frontendUrl: string;
    try {
      const state = JSON.parse(atob(decodeURIComponent(stateParam)));
      csrfToken = state.csrf;
      frontendUrl = state.origin || defaultFrontendUrl;
      if (state.flow !== "signup") {
        return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=invalid_flow`, 302);
      }
    } catch {
      return Response.redirect(`${defaultFrontendUrl}/signup?xero_signup=error&reason=invalid_state`, 302);
    }

    if (!csrfToken) {
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=missing_csrf`, 302);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: csrfRecord, error: csrfError } = await supabase
      .from("xero_oauth_states")
      .select("id, created_at, pending_signup")
      .eq("csrf_token", csrfToken)
      .eq("flow", "signup")
      .is("user_id", null)
      .eq("used", false)
      .maybeSingle();

    if (csrfError || !csrfRecord?.pending_signup) {
      console.error("[xero-signup-callback] CSRF validation failed:", csrfError);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=invalid_csrf`, 302);
    }

    const pending = csrfRecord.pending_signup as PendingSignup;
    if (!pending.firm_name) {
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=invalid_pending`, 302);
    }

    const tokenAge = Date.now() - new Date(csrfRecord.created_at).getTime();
    if (tokenAge > 10 * 60 * 1000) {
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=expired_csrf`, 302);
    }

    await supabase.from("xero_oauth_states").update({ used: true }).eq("id", csrfRecord.id);

    const clientId = Deno.env.get("XERO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-signup-callback`;

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
      console.error("[xero-signup-callback] Token exchange failed:", errBody);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=token_exchange_failed`, 302);
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    if (!tokens.id_token) {
      console.error("[xero-signup-callback] Missing id_token");
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=no_id_token`, 302);
    }

    let idPayload;
    try {
      idPayload = await verifyXeroIdToken(tokens.id_token, clientId);
    } catch (e) {
      console.error("[xero-signup-callback] id_token verify failed:", e);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=invalid_id_token`, 302);
    }

    const emailRaw = idPayload.email;
    if (!emailRaw || typeof emailRaw !== "string") {
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=no_email`, 302);
    }
    const email = emailRaw.toLowerCase().trim();

    const given = typeof idPayload.given_name === "string" ? idPayload.given_name : "";
    const family = typeof idPayload.family_name === "string" ? idPayload.family_name : "";
    const fullName = `${given} ${family}`.trim() || email.split("@")[0] || "User";
    const xeroUserId = typeof idPayload.xero_userid === "string" ? idPayload.xero_userid : undefined;

    const existing = await findAuthUserByEmail(supabase, email);
    if (existing) {
      return Response.redirect(
        `${frontendUrl}/login?xero_signup=exists&email=${encodeURIComponent(email)}`,
        302,
      );
    }

    const plan = pending.selected_plan || "pro";
    const billing = pending.selected_billing || "monthly";
    const firmName = pending.firm_name.trim();

    const randomPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        signup_source: "xero",
        ...(xeroUserId ? { xero_userid: xeroUserId } : {}),
      },
    });

    if (authError) {
      console.error("[xero-signup-callback] createUser:", authError);
      const msg = authError.message?.includes("already been registered") ? "account_exists" : "create_user_failed";
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=${msg}`, 302);
    }

    const userId = authData.user.id;
    const now = new Date();

    // No trial here — Stripe creates and manages the 7-day trial once the owner
    // attaches a payment method through Checkout (/complete-setup).
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        name: firmName.toLowerCase().replace(/\s+/g, "-"),
        firm_name: firmName,
        subscription_status: "incomplete",
        subscription_plan: plan,
        selected_plan: plan,
        diagram_limit: 3,
        payment_method_captured: false,
        access_enabled: false,
        access_locked_reason: "payment_method_required",
      })
      .select("id")
      .single();

    if (tenantError) {
      console.error("[xero-signup-callback] tenant:", tenantError);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=tenant_failed`, 302);
    }

    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
        const customer = await stripe.customers.create({
          email,
          metadata: { workspace_id: tenant.id, owner_user_id: userId },
        });
        await supabase.from("tenants").update({
          stripe_customer_id: customer.id,
          stripe_mode: stripeMode(),
        }).eq("id", tenant.id);
      } catch (stripeErr: unknown) {
        console.error("[xero-signup-callback] Stripe:", stripeErr);
      }
    }

    const { error: tuError } = await supabase.from("tenant_users").insert({
      tenant_id: tenant.id,
      email,
      display_name: fullName,
      role: "owner",
      status: "active",
      auth_user_id: userId,
      accepted_at: now.toISOString(),
      invited_at: now.toISOString(),
      last_invited_at: now.toISOString(),
    });
    if (tuError) {
      console.error("[xero-signup-callback] tenant_users:", tuError);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=tenant_user_failed`, 302);
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      user_id: userId,
      tenant_id: tenant.id,
      full_name: fullName,
      status: "active",
      onboarding_complete: true,
      selected_plan: plan,
      selected_billing: billing,
    }, { onConflict: "user_id" });
    if (profileError) {
      console.error("[xero-signup-callback] profile:", profileError);
      return Response.redirect(`${frontendUrl}/signup?xero_signup=error&reason=profile_failed`, 302);
    }

    const { error: roleError } = await supabase.from("user_roles").insert({
      user_id: userId,
      role: "admin",
    });
    if (roleError) {
      console.error("[xero-signup-callback] user_roles:", roleError);
    }

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

    if (tokens.refresh_token) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const encryptedAccessToken = await encryptToken(tokens.access_token);
      const encryptedRefreshToken = await encryptToken(tokens.refresh_token);
      const { error: xcError } = await supabase.from("xero_connections").upsert(
        {
          user_id: userId,
          tenant_id: String(tenant.id),
          xero_tenant_id: xeroTenantId,
          xero_org_name: xeroOrgName,
          connected_by_email: email,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          connected_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id,tenant_id" },
      );
      if (xcError) console.error("[xero-signup-callback] xero_connections:", xcError);
    }

    await supabase.from("xero_oauth_states").delete().eq("id", csrfRecord.id);

    try {
      await invokeTransactionalEmail({
        templateName: "welcome",
        recipientEmail: email,
        templateData: { name: fullName },
        idempotencyKey: `welcome:${userId}`,
      });
    } catch (err) {
      console.error("[xero-signup-callback] welcome email:", err);
    }

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${frontendUrl}/` },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[xero-signup-callback] generateLink:", linkError);
      return Response.redirect(
        `${frontendUrl}/login?xero_signup=done&email=${encodeURIComponent(email)}`,
        302,
      );
    }

    return Response.redirect(linkData.properties.action_link, 302);
  } catch (err) {
    console.error("xero-signup-callback error:", err);
    const fallback = Deno.env.get("FRONTEND_URL") || "https://link-map-insight.lovable.app";
    return Response.redirect(`${fallback}/signup?xero_signup=error&reason=server_error`, 302);
  }
});
