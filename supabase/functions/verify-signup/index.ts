import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const { email, code, action } = await req.json();

    if (!email) return json({ error: "Email is required" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── RESEND ──────────────────────────────────────────────────────
    if (action === "resend") {
      const { data: verRow } = await supabaseAdmin
        .from("signup_verifications")
        .select("user_id")
        .eq("email", email.toLowerCase())
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!verRow) return json({ error: "No pending verification found" }, 400);

      await supabaseAdmin
        .from("signup_verifications")
        .update({ used: true })
        .eq("email", email.toLowerCase())
        .eq("used", false);

      const newCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await supabaseAdmin.from("signup_verifications").insert({
        user_id: verRow.user_id,
        email: email.toLowerCase(),
        code: newCode,
        expires_at: expiresAt,
      });

      try {
        await sendViaSmtp2go(
          email,
          `Verify your strukcha account — ${newCode}`,
          renderVerificationHtml(newCode),
          `Your strukcha verification code is: ${newCode}. It expires in 10 minutes.`
        );
      } catch (sendErr) {
        console.error("[VerifySignup] Failed to send email:", sendErr);
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

    if (!codeRow) return json({ error: "Invalid or expired code" }, 400);

    await supabaseAdmin
      .from("signup_verifications")
      .update({ used: true })
      .eq("id", codeRow.id);

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
