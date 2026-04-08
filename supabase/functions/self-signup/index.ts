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

const SITE_NAME = "strukcha";
const FROM_DOMAIN = "strukcha.app";

function renderVerificationHtml(code: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin-bottom:16px;color:#18181b">Verify your email</h2>
<p style="color:#52525b;font-size:15px">Enter this code to complete your strukcha signup:</p>
<p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0;color:#18181b">${code}</p>
<p style="color:#71717a;font-size:14px">This code expires in 10 minutes. If you didn't sign up for strukcha, ignore this email.</p>
</div>`;
}

async function sendViaSmtp2go(to: string, subject: string, html: string, text?: string): Promise<void> {
  const apiKey = Deno.env.get("SMTP2GO_API_KEY");
  if (!apiKey) throw new Error("SMTP2GO_API_KEY not configured");

  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      sender: `${SITE_NAME} <no-reply@${FROM_DOMAIN}>`,
      to: [to],
      subject,
      html_body: html,
      text_body: text || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`smtp2go error ${response.status}: ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { fullName, email, password, firmName, selectedPlan, selectedBilling } = await req.json();
    if (!email || !password || !firmName || !fullName) {
      return json({ error: "Missing required fields" }, 400);
    }
    const plan = selectedPlan || "pro";
    const billing = selectedBilling || "monthly";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Create the auth user (NOT confirmed)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      const msg = authError.message?.includes("already been registered")
        ? "An account with this email already exists. Please log in instead."
        : authError.message;
      return json({ error: msg }, 400);
    }

    const userId = authData.user.id;

    // 2. Create the tenant
    const now = new Date();
    // 10-minute trial for testing
    const trialEnd = new Date(now.getTime() + 10 * 60 * 1000);

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: firmName.toLowerCase().replace(/\s+/g, "-"),
        firm_name: firmName,
        trial_starts_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        subscription_status: "trialing",
      })
      .select("id")
      .single();

    if (tenantError) throw tenantError;

    // 2b. Create Stripe customer + subscription with 7-day trial
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const customer = await stripe.customers.create({
          email,
          metadata: { workspace_id: tenant.id, owner_user_id: userId },
        });

        const trialEndUnix = Math.floor(trialEnd.getTime() / 1000);
        const planPrices = PRICE_MAP[plan] || PRICE_MAP.pro;
        const priceId = planPrices?.[billing] || planPrices?.monthly;
        if (!priceId) throw new Error(`No Stripe price configured for plan: ${plan}, billing: ${billing}`);

        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
          trial_end: trialEndUnix,
          metadata: { workspace_id: tenant.id },
        });

        await supabaseAdmin.from("tenants").update({
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          subscription_status: "trialing",
          trial_used_at: now.toISOString(),
        }).eq("id", tenant.id);

        console.log(`[Signup] Stripe customer ${customer.id} and subscription ${subscription.id} created with 7-day trial`);
      } catch (stripeErr: any) {
        console.error("[Signup] Stripe setup failed:", stripeErr.message);
      }
    }

    // 3. Create tenant_user row (owner)
    const { error: tuError } = await supabaseAdmin.from("tenant_users").insert({
      tenant_id: tenant.id,
      email: email.toLowerCase(),
      display_name: fullName,
      role: "owner",
      status: "active",
      auth_user_id: userId,
      accepted_at: now.toISOString(),
      invited_at: now.toISOString(),
      last_invited_at: now.toISOString(),
    });
    if (tuError) throw tuError;

    // 4. Create profile
    const { error: profileError } = await supabaseAdmin.from("profiles")
      .upsert({
        user_id: userId,
        tenant_id: tenant.id,
        full_name: fullName,
        status: "active",
        onboarding_complete: true,
        selected_plan: plan,
        selected_billing: billing,
      }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    // 5. Create user_roles
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: "admin",
    });
    if (roleError) throw roleError;

    // 6. Generate verification code & send directly via smtp2go
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseAdmin.from("signup_verifications").insert({
      user_id: userId,
      email: email.toLowerCase(),
      code: verificationCode,
      expires_at: expiresAt,
    });

    try {
      await sendViaSmtp2go(
        email,
        `Verify your strukcha account — ${verificationCode}`,
        renderVerificationHtml(verificationCode),
        `Your strukcha verification code is: ${verificationCode}. It expires in 10 minutes.`
      );
      console.log(`[Signup] Verification email sent to ${email}`);
    } catch (sendErr) {
      console.error("[Signup] Failed to send verification email:", sendErr);
      console.log(`[Signup] Verification code for ${email}: ${verificationCode}`);
    }

    return json({ ok: true, needsVerification: true, userId });
  } catch (err: any) {
    console.error("self-signup error:", err);
    return json({ error: err.message || "Signup failed" }, 500);
  }
});
