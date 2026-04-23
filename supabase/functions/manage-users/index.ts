import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_NAME = "strukcha";
const FROM_DOMAIN = "strukcha.app";

function buildSetupPasswordRedirect(): string | null {
  const frontendUrl = Deno.env.get("FRONTEND_URL");
  if (!frontendUrl) return null;
  try {
    const url = new URL(frontendUrl);
    url.pathname = "/setup-password";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function renderInviteHtml(actionLink: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px">
<h2 style="margin-bottom:12px;color:#18181b">You've been invited to ${SITE_NAME}</h2>
<p style="color:#52525b;font-size:15px;line-height:1.5">Click below to accept your invitation and set your password.</p>
<div style="margin:24px 0;text-align:center">
  <a href="${actionLink}" style="background:#111827;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Accept invitation</a>
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

function isRateLimitError(message?: string): boolean {
  return (message ?? "").toLowerCase().includes("email rate limit exceeded");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user: callingUser } } = await userClient.auth.getUser();
    if (!callingUser) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { action, tenant_id } = body;
    const setupPasswordRedirect = buildSetupPasswordRedirect();

    // ── invite ──────────────────────────────────────────────────────
    if (action === "invite") {
      const { email, role, display_name } = body;
      if (!email || !tenant_id) return json({ error: "email and tenant_id required" }, 400);

      // Call RPC to create/upsert tenant_users record
      const { data: rpcData, error: rpcErr } = await userClient.rpc(
        "rpc_create_tenant_user_invite",
        { p_tenant_id: tenant_id, p_email: email.trim().toLowerCase(), p_role: role || "user", p_display_name: display_name || null }
      );
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      // Send magic link via admin API
      const normalizedEmail = email.trim().toLowerCase();
      const inviteOptions = setupPasswordRedirect ? { redirectTo: setupPasswordRedirect } : undefined;
      const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email: normalizedEmail,
        options: inviteOptions,
      });

      let actionLink = linkData?.properties?.action_link;

      // Existing users cannot always be invited again; fallback to recovery link.
      if (linkErr && linkErr.message?.includes("already been registered")) {
        const { data: recoveryData, error: recoveryErr } = await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: normalizedEmail,
          options: inviteOptions,
        });
        if (recoveryErr) {
          console.error("Recovery link error:", recoveryErr.message);
          if (isRateLimitError(recoveryErr.message)) {
            return json({ error: "email rate limit exceeded" }, 429);
          }
          return json({ error: recoveryErr.message }, 500);
        }
        actionLink = recoveryData?.properties?.action_link;
      } else if (linkErr) {
        console.error("Invite link error:", linkErr.message);
        if (isRateLimitError(linkErr.message)) {
          return json({ error: "email rate limit exceeded" }, 429);
        }
        return json({ error: linkErr.message }, 500);
      }

      if (!actionLink) {
        return json({ error: "Failed to generate invitation link" }, 500);
      }

      try {
        await sendViaSmtp2go(
          normalizedEmail,
          "You're invited to strukcha",
          renderInviteHtml(actionLink),
          `Accept your invitation and set your password: ${actionLink}`
        );
      } catch (smtpErr: any) {
        return json({ error: smtpErr?.message || "Failed to send invitation email" }, 500);
      }

      return json({ success: true, data: rpcData });
    }

    // ── reinvite ─────────────────────────────────────────────────────
    if (action === "reinvite") {
      const { tenant_user_id } = body;
      if (!tenant_user_id || !tenant_id) return json({ error: "tenant_user_id and tenant_id required" }, 400);

      const { data: rpcData, error: rpcErr } = await userClient.rpc(
        "rpc_reinvite_tenant_user",
        { p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id }
      );
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      const email = (rpcData as any)?.email;
      if (email) {
        const { data: linkData, error: mlErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: setupPasswordRedirect ? { redirectTo: setupPasswordRedirect } : undefined,
        });
        if (mlErr) {
          console.error("Magic link error:", mlErr.message);
          if (isRateLimitError(mlErr.message)) {
            return json({ error: "email rate limit exceeded" }, 429);
          }
          return json({ error: mlErr.message }, 500);
        }
        const actionLink = linkData?.properties?.action_link;
        if (!actionLink) return json({ error: "Failed to generate reinvite link" }, 500);
        try {
          await sendViaSmtp2go(
            email,
            "Your strukcha sign-in link",
            renderInviteHtml(actionLink),
            `Use this secure link to continue: ${actionLink}`
          );
        } catch (smtpErr: any) {
          return json({ error: smtpErr?.message || "Failed to send invitation email" }, 500);
        }
      }

      return json({ success: true });
    }

    // ── disable ───────────────────────────────────────────────────────
    if (action === "disable") {
      const { tenant_user_id } = body;
      if (!tenant_user_id || !tenant_id) return json({ error: "tenant_user_id and tenant_id required" }, 400);

      const { error: rpcErr } = await userClient.rpc("rpc_disable_tenant_user", {
        p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      // Ban the user in auth if they have an auth_user_id
      const { data: tu } = await adminClient
        .from("tenant_users").select("auth_user_id").eq("id", tenant_user_id).single();
      if (tu?.auth_user_id) {
        await adminClient.auth.admin.updateUserById(tu.auth_user_id, { ban_duration: "876600h" });
      }

      return json({ success: true });
    }

    // ── enable ────────────────────────────────────────────────────────
    if (action === "enable") {
      const { tenant_user_id } = body;
      if (!tenant_user_id || !tenant_id) return json({ error: "tenant_user_id and tenant_id required" }, 400);

      const { error: rpcErr } = await userClient.rpc("rpc_enable_tenant_user", {
        p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      // Unban in auth
      const { data: tu } = await adminClient
        .from("tenant_users").select("auth_user_id").eq("id", tenant_user_id).single();
      if (tu?.auth_user_id) {
        await adminClient.auth.admin.updateUserById(tu.auth_user_id, { ban_duration: "none" });
      }

      return json({ success: true });
    }

    // ── soft_delete ───────────────────────────────────────────────────
    if (action === "soft_delete") {
      const { tenant_user_id } = body;
      if (!tenant_user_id || !tenant_id) return json({ error: "tenant_user_id and tenant_id required" }, 400);

      const { error: rpcErr } = await userClient.rpc("rpc_soft_delete_tenant_user", {
        p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      // Ban in auth too
      const { data: tu } = await adminClient
        .from("tenant_users").select("auth_user_id").eq("id", tenant_user_id).single();
      if (tu?.auth_user_id) {
        await adminClient.auth.admin.updateUserById(tu.auth_user_id, { ban_duration: "876600h" });
      }

      return json({ success: true });
    }

    // ── restore ───────────────────────────────────────────────────────
    if (action === "restore") {
      const { tenant_user_id } = body;
      if (!tenant_user_id || !tenant_id) return json({ error: "tenant_user_id and tenant_id required" }, 400);

      const { data: rpcData, error: rpcErr } = await userClient.rpc("rpc_restore_tenant_user", {
        p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      const email = (rpcData as any)?.email;
      if (email) {
        const { data: linkData, error: mlErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: setupPasswordRedirect ? { redirectTo: setupPasswordRedirect } : undefined,
        });
        if (mlErr) {
          console.error("Magic link error:", mlErr.message);
          if (isRateLimitError(mlErr.message)) {
            return json({ error: "email rate limit exceeded" }, 429);
          }
          return json({ error: mlErr.message }, 500);
        }
        const actionLink = linkData?.properties?.action_link;
        if (!actionLink) return json({ error: "Failed to generate restore link" }, 500);
        try {
          await sendViaSmtp2go(
            email,
            "Your strukcha sign-in link",
            renderInviteHtml(actionLink),
            `Use this secure link to continue: ${actionLink}`
          );
        } catch (smtpErr: any) {
          return json({ error: smtpErr?.message || "Failed to send invitation email" }, 500);
        }
      }

      return json({ success: true });
    }

    // ── change_role ───────────────────────────────────────────────────
    if (action === "change_role") {
      const { tenant_user_id, new_role } = body;
      if (!tenant_user_id || !new_role || !tenant_id) return json({ error: "tenant_user_id, new_role and tenant_id required" }, 400);

      const { error: rpcErr } = await userClient.rpc("rpc_change_tenant_user_role", {
        p_tenant_id: tenant_id, p_tenant_user_id: tenant_user_id, p_new_role: new_role,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400);

      return json({ success: true });
    }

    // ── toggle_integrations ──────────────────────────────────────────
    if (action === "toggle_integrations") {
      const { tenant_user_id, grant } = body;
      if (!tenant_user_id || !tenant_id || grant === undefined) return json({ error: "tenant_user_id, tenant_id and grant required" }, 400);

      // Verify caller is owner
      const { data: callerTuInt } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("tenant_id", tenant_id)
        .eq("auth_user_id", callingUser.id)
        .eq("status", "active")
        .single();

      if (callerTuInt?.role !== "owner") return json({ error: "Only owners can manage integration access" }, 403);

      // Verify target is an admin
      const { data: targetTuInt } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (targetTuInt?.role !== "admin") return json({ error: "Integration access can only be granted to admin users" }, 400);

      // If granting, check exclusivity — only one admin can hold this at a time
      if (grant) {
        const { data: existingHolder } = await adminClient
          .from("tenant_users")
          .select("id, display_name, email")
          .eq("tenant_id", tenant_id)
          .eq("can_manage_integrations", true)
          .eq("status", "active")
          .neq("id", tenant_user_id)
          .limit(1)
          .maybeSingle();

        if (existingHolder) {
          return json({
            error: "integration_already_granted",
            holder_name: existingHolder.display_name || existingHolder.email,
          }, 409);
        }
      }

      const { error: updateErrInt } = await adminClient
        .from("tenant_users")
        .update({ can_manage_integrations: !!grant })
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id);

      if (updateErrInt) return json({ error: updateErrInt.message }, 400);

      return json({ success: true });
    }

    // ── toggle_billing ──────────────────────────────────────────────
    if (action === "toggle_billing") {
      const { tenant_user_id, grant } = body;
      if (!tenant_user_id || !tenant_id || grant === undefined) return json({ error: "tenant_user_id, tenant_id and grant required" }, 400);

      // Verify caller is owner
      const { data: callerTuBill } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("tenant_id", tenant_id)
        .eq("auth_user_id", callingUser.id)
        .eq("status", "active")
        .single();

      if (callerTuBill?.role !== "owner") return json({ error: "Only owners can manage billing access" }, 403);

      // Verify target is an admin
      const { data: targetTuBill } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (targetTuBill?.role !== "admin") return json({ error: "Billing access can only be granted to admin users" }, 400);

      // If granting, check exclusivity
      if (grant) {
        const { data: existingBillHolder } = await adminClient
          .from("tenant_users")
          .select("id, display_name, email")
          .eq("tenant_id", tenant_id)
          .eq("can_manage_billing", true)
          .eq("status", "active")
          .neq("id", tenant_user_id)
          .limit(1)
          .maybeSingle();

        if (existingBillHolder) {
          return json({
            error: "billing_already_granted",
            holder_name: existingBillHolder.display_name || existingBillHolder.email,
          }, 409);
        }
      }

      const { error: updateErrBill } = await adminClient
        .from("tenant_users")
        .update({ can_manage_billing: !!grant })
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id);

      if (updateErrBill) return json({ error: updateErrBill.message }, 400);

      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    console.error("manage-users error:", err);
    return json({ error: err.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
