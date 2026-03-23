import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_NAME = "strukcha";
const SENDER_DOMAIN = "notify.strukcha.app";
const FROM_DOMAIN = "strukcha.app";

function renderMfaHtml(code: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin-bottom:16px;color:#18181b">Your verification code</h2>
<p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0;color:#18181b">${code}</p>
<p style="color:#71717a;font-size:14px">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Authenticate caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { action, code } = await req.json();

    // ── SEND ────────────────────────────────────────────────────────
    if (action === "send") {
      const verificationCode = String(
        Math.floor(100000 + Math.random() * 900000)
      );
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Invalidate previous unused codes
      await adminClient
        .from("mfa_email_codes")
        .update({ used: true })
        .eq("user_id", user.id)
        .eq("used", false);

      // Store new code
      await adminClient.from("mfa_email_codes").insert({
        user_id: user.id,
        code: verificationCode,
        expires_at: expiresAt,
      });

      // Enqueue email via Lovable email queue
      const messageId = crypto.randomUUID();
      const { error: enqueueError } = await adminClient.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          message_id: messageId,
          to: user.email,
          from: `${SITE_NAME} <no-reply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject: `Your verification code: ${verificationCode}`,
          html: renderMfaHtml(verificationCode),
          text: `Your strukcha verification code is: ${verificationCode}. It expires in 5 minutes.`,
          purpose: "transactional",
          label: "mfa-email",
          idempotency_key: messageId,
          queued_at: new Date().toISOString(),
        },
      });

      if (enqueueError) {
        console.error("[MFA] Failed to enqueue email:", enqueueError);
        console.log(`[MFA] Verification code for ${user.email}: ${verificationCode}`);
      } else {
        console.log(`[MFA] Verification email enqueued for ${user.email}`);
      }

      return json({ ok: true });
    }

    // ── VERIFY ──────────────────────────────────────────────────────
    if (action === "verify") {
      if (!code || typeof code !== "string" || code.length !== 6) {
        return json({ error: "Invalid code format" }, 400);
      }

      const { data: codeRow } = await adminClient
        .from("mfa_email_codes")
        .select("*")
        .eq("user_id", user.id)
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
      await adminClient
        .from("mfa_email_codes")
        .update({ used: true })
        .eq("id", codeRow.id);

      // Create verification record (24 hour validity)
      await adminClient.from("mfa_verifications").insert({
        user_id: user.id,
        method: "email",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      return json({ ok: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    console.error("[mfa-email] Error:", err);
    return json({ error: err.message ?? "Internal error" }, 500);
  }
});
