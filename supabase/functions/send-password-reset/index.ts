import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_NAME = "strukcha";
const FROM_DOMAIN = "strukcha.app";
const PROD_FRONTEND_URL = "https://strukcha.app";

function buildResetRedirect(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const isLocalRuntime = supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");
  const configured = Deno.env.get("FRONTEND_URL") || PROD_FRONTEND_URL;
  try {
    const url = new URL(configured);
    if (!isLocalRuntime && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return `${PROD_FRONTEND_URL}/reset-password`;
    }
    url.pathname = "/reset-password";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${PROD_FRONTEND_URL}/reset-password`;
  }
}

function forceRedirectOnActionLink(actionLink: string, redirectTo: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}

function renderResetHtml(actionLink: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px">
<h2 style="margin-bottom:12px;color:#18181b">Reset your ${SITE_NAME} password</h2>
<p style="color:#52525b;font-size:15px;line-height:1.5">Click below to choose a new password.</p>
<div style="margin:24px 0;text-align:center">
  <a href="${actionLink}" style="background:#111827;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Reset password</a>
</div>
<p style="color:#71717a;font-size:13px;line-height:1.5">If the button does not work, copy and paste this URL into your browser:</p>
<p style="word-break:break-all;color:#334155;font-size:12px">${actionLink}</p>
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { email } = await req.json();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail) return json({ error: "email is required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const redirectTo = buildResetRedirect();
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo },
    });

    // Always return generic success to avoid user enumeration.
    if (error || !data?.properties?.action_link) {
      return json({ ok: true });
    }

    const actionLink = forceRedirectOnActionLink(data.properties.action_link, redirectTo);
    await sendViaSmtp2go(
      normalizedEmail,
      "Reset your strukcha password",
      renderResetHtml(actionLink),
      `Reset your password using this secure link: ${actionLink}`
    );

    return json({ ok: true });
  } catch (err) {
    console.error("send-password-reset error:", err);
    return json({ error: "Unable to process password reset request" }, 500);
  }
});
