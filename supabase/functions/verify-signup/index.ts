import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { email, code, action } = await req.json();

    if (!email) return json({ error: "Email is required" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── RESEND ──────────────────────────────────────────────────────
    if (action === "resend") {
      // Find the user by email
      const { data: verRow } = await supabaseAdmin
        .from("signup_verifications")
        .select("user_id")
        .eq("email", email.toLowerCase())
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!verRow) return json({ error: "No pending verification found" }, 400);

      // Invalidate old codes
      await supabaseAdmin
        .from("signup_verifications")
        .update({ used: true })
        .eq("email", email.toLowerCase())
        .eq("used", false);

      // Generate new code
      const newCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await supabaseAdmin.from("signup_verifications").insert({
        user_id: verRow.user_id,
        email: email.toLowerCase(),
        code: newCode,
        expires_at: expiresAt,
      });

      // Send email via SMTP
      try {
        await sendSmtpEmail(email, newCode);
      } catch (e) {
        console.error("[VerifySignup] SMTP failed:", e);
        console.log(`[VerifySignup] Code for ${email}: ${newCode}`);
      }

      return json({ ok: true });
    }

    // ── VERIFY ──────────────────────────────────────────────────────
    if (!code || typeof code !== "string" || code.length !== 6) {
      return json({ error: "Invalid code format" }, 400);
    }

    const { data: codeRow } = await supabaseAdmin
      .from("signup_verifications")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!codeRow) {
      return json({ error: "Invalid or expired code" }, 400);
    }

    // Mark code as used
    await supabaseAdmin
      .from("signup_verifications")
      .update({ used: true })
      .eq("id", codeRow.id);

    // Confirm the user's email via admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      codeRow.user_id,
      { email_confirm: true }
    );

    if (updateError) {
      console.error("[VerifySignup] Failed to confirm email:", updateError);
      return json({ error: "Failed to verify email" }, 500);
    }

    return json({ ok: true, verified: true });
  } catch (err: any) {
    console.error("[verify-signup] Error:", err);
    return json({ error: err.message || "Verification failed" }, 500);
  }
});

// ── SMTP helper (same pattern as mfa-email) ─────────────────────────
async function sendSmtpEmail(to: string, code: string) {
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  if (!smtpUser || !smtpPass) {
    console.log(`[VerifySignup] No SMTP — code for ${to}: ${code}`);
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

  await readLine();
  await send("EHLO strukcha.app");
  await send("AUTH LOGIN");
  await send(btoa(smtpUser));
  const authRes = await send(btoa(smtpPass));
  if (!authRes.startsWith("235")) throw new Error("SMTP auth failed: " + authRes);

  await send(`MAIL FROM:<${smtpUser}>`);
  await send(`RCPT TO:<${to}>`);
  await send("DATA");

  const emailBody = [
    `From: strukcha <${smtpUser}>`,
    `To: ${to}`,
    `Subject: Verify your strukcha account — ${code}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">`,
    `<h2 style="margin-bottom:16px;color:#18181b">Verify your email</h2>`,
    `<p style="color:#52525b;font-size:15px">Enter this code to complete your strukcha signup:</p>`,
    `<p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;`,
    `background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0;color:#18181b">`,
    `${code}</p>`,
    `<p style="color:#71717a;font-size:14px">This code expires in 10 minutes. If you didn't sign up for strukcha, ignore this email.</p>`,
    `</div>`,
    `.`,
  ].join("\r\n");

  const dataRes = await send(emailBody);
  if (!dataRes.startsWith("250")) console.error("SMTP send may have failed:", dataRes);
  await send("QUIT");
  conn.close();
  console.log(`[VerifySignup] Email sent to ${to}`);
}
