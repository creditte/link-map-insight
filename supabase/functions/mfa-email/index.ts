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

      // Attempt to send email via Resend if configured
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Strukcha <noreply@strukcha.app>",
              to: [user.email],
              subject: `Your verification code: ${verificationCode}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">
                  <h2 style="margin-bottom:16px">Your verification code</h2>
                  <p style="font-size:36px;letter-spacing:10px;font-weight:bold;text-align:center;
                     background:#f4f4f5;padding:16px;border-radius:8px;margin:24px 0">
                    ${verificationCode}
                  </p>
                  <p style="color:#71717a;font-size:14px">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
                </div>`,
            }),
          });
        } catch (e) {
          console.error("Email send failed:", e);
        }
      } else {
        // Log code for development/testing
        console.log(
          `[MFA] Verification code for ${user.email}: ${verificationCode}`
        );
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
