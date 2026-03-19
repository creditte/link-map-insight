import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendSmtpEmail(to: string, code: string) {
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  if (!smtpUser || !smtpPass) {
    console.log(`[Signup] No SMTP creds — verification code for ${to}: ${code}`);
    return;
  }

  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function readLine(): Promise<string> {
    const buf = new Uint8Array(1024);
    const n = await conn.read(buf);
    return decoder.decode(buf.subarray(0, n ?? 0));
  }
  async function send(cmd: string) {
    await conn.write(encoder.encode(cmd + "\r\n"));
    return await readLine();
  }

  await readLine(); // greeting
  await send("EHLO strukcha.app");
  await send("AUTH LOGIN");
  await send(btoa(smtpUser));
  const authRes = await send(btoa(smtpPass));
  if (!authRes.startsWith("235")) throw new Error("SMTP auth failed: " + authRes);

  await send(`MAIL FROM:<${smtpUser}>`);
  await send(`RCPT TO:<${to}>`);
  await send("DATA");

  const emailBody = [
    `From: Strukcha <${smtpUser}>`,
    `To: ${to}`,
    `Subject: Verify your Strukcha account — ${code}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">`,
    `<h2 style="margin-bottom:16px;color:#18181b">Verify your email</h2>`,
    `<p style="color:#52525b;font-size:15px">Enter this code to complete your Strukcha signup:</p>`,
    `<p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;`,
    `background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0;color:#18181b">`,
    `${code}</p>`,
    `<p style="color:#71717a;font-size:14px">This code expires in 10 minutes. If you didn't sign up for Strukcha, ignore this email.</p>`,
    `</div>`,
    `.`,
  ].join("\r\n");

  const dataRes = await send(emailBody);
  if (!dataRes.startsWith("250")) {
    console.error("SMTP send may have failed:", dataRes);
  }
  await send("QUIT");
  conn.close();
  console.log(`[Signup] Verification email sent to ${to}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { fullName, email, password, firmName } = await req.json();
    if (!email || !password || !firmName || !fullName) {
      return json({ error: "Missing required fields" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Create the auth user (NOT confirmed — must verify email first)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // Requires email verification
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
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
      }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    // 5. Create user_roles
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: "admin",
    });
    if (roleError) throw roleError;

    // 6. Generate verification code & send email
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseAdmin.from("signup_verifications").insert({
      user_id: userId,
      email: email.toLowerCase(),
      code: verificationCode,
      expires_at: expiresAt,
    });

    try {
      await sendSmtpEmail(email, verificationCode);
    } catch (e) {
      console.error("[Signup] SMTP failed:", e);
      console.log(`[Signup] Verification code for ${email}: ${verificationCode}`);
    }

    return json({ ok: true, needsVerification: true, userId });
  } catch (err: any) {
    console.error("self-signup error:", err);
    return json({ error: err.message || "Signup failed" }, 500);
  }
});
