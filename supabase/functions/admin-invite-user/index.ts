import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SITE_NAME = "strukcha";
const FROM_DOMAIN = "strukcha.app";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const frontendUrl = Deno.env.get("FRONTEND_URL") || supabaseUrl;

    let setupPasswordRedirect = frontendUrl;
    try {
      const url = new URL(frontendUrl);
      url.pathname = "/setup-password";
      url.search = "";
      url.hash = "";
      setupPasswordRedirect = url.toString();
    } catch {
      // fallback to FRONTEND_URL as-is if parsing fails
    }

    // Verify caller is a super admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check super admin
    const { data: saRow } = await anonClient
      .from("super_admins")
      .select("id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();

    if (!saRow) {
      return new Response(JSON.stringify({ error: "Forbidden: super admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, tenant_id, display_name, role } = await req.json();

    if (!email || !tenant_id) {
      return new Response(
        JSON.stringify({ error: "email and tenant_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const _email = email.toLowerCase().trim();
    const _role = role || "owner";

    // 1. Create/upsert tenant_users record
    const { error: tuError } = await adminClient
      .from("tenant_users")
      .upsert(
        {
          tenant_id,
          email: _email,
          display_name: display_name || null,
          role: _role,
          status: "invited",
          invited_at: new Date().toISOString(),
          last_invited_at: new Date().toISOString(),
          invited_by: caller.id,
        },
        { onConflict: "tenant_id,email" }
      );

    if (tuError) {
      return new Response(JSON.stringify({ error: tuError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Generate invite/recovery link and send via SMTP2GO
    const { data: inviteData, error: inviteError } =
      await adminClient.auth.admin.generateLink({
        type: "invite",
        email: _email,
        options: { redirectTo: setupPasswordRedirect },
      });

    if (inviteError) {
      // If user already exists, update their profile to new tenant and reset onboarding
      if (inviteError.message?.includes("already been registered")) {
        // Find the existing auth user
        const { data: listData } = await adminClient.auth.admin.listUsers();
        const existingUser = listData?.users?.find(
          (u: any) => u.email?.toLowerCase() === _email
        );

        if (existingUser) {
          // Update tenant_users to link this auth user
          await adminClient
            .from("tenant_users")
            .update({
              auth_user_id: existingUser.id,
              status: "invited",
              last_invited_at: new Date().toISOString(),
            })
            .eq("tenant_id", tenant_id)
            .eq("email", _email);

          // Update profile to new tenant and reset onboarding
          const { error: profileError } = await adminClient
            .from("profiles")
            .update({
              tenant_id,
              onboarding_complete: false,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", existingUser.id);

          // If no profile exists, create one
          if (profileError) {
            await adminClient.from("profiles").insert({
              user_id: existingUser.id,
              tenant_id,
              full_name: display_name || "",
              status: "active",
              onboarding_complete: false,
            });
          }

          // Update user_roles to match the new role
          const appRole = (_role === "owner" || _role === "admin") ? "admin" : "user";
          await adminClient
            .from("user_roles")
            .upsert(
              { user_id: existingUser.id, role: appRole },
              { onConflict: "user_id,role" }
            );
        }

        // Send a password recovery link so user can set password for new tenant
        const { data: recoveryData, error: _resetError } = await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: _email,
          options: { redirectTo: setupPasswordRedirect },
        });
        if (_resetError) {
          return new Response(JSON.stringify({ error: _resetError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const recoveryLink = recoveryData?.properties?.action_link;
        if (!recoveryLink) {
          return new Response(JSON.stringify({ error: "Failed to generate recovery link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        try {
          await sendViaSmtp2go(
            _email,
            "You're invited to strukcha",
            renderInviteHtml(recoveryLink),
            `Accept your invitation and set your password: ${recoveryLink}`
          );
        } catch (smtpErr: any) {
          return new Response(JSON.stringify({ error: smtpErr?.message || "Failed to send invitation email" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            message: existingUser
              ? "Existing user moved to new firm. They will be prompted to set password on next login."
              : "User record updated. Magic link could not be sent.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inviteLink = inviteData?.properties?.action_link;
    if (!inviteLink) {
      return new Response(JSON.stringify({ error: "Failed to generate invitation link" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      await sendViaSmtp2go(
        _email,
        "You're invited to strukcha",
        renderInviteHtml(inviteLink),
        `Accept your invitation and set your password: ${inviteLink}`
      );
    } catch (smtpErr: any) {
      return new Response(JSON.stringify({ error: smtpErr?.message || "Failed to send invitation email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Directly link the new user to avoid handle_new_user race condition
    const newUserId = inviteData?.user?.id;
    if (newUserId) {
      // Link tenant_users record
      await adminClient
        .from("tenant_users")
        .update({
          auth_user_id: newUserId,
          status: "invited",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenant_id)
        .eq("email", _email);

      // Upsert profile with correct tenant (overrides handle_new_user fallback)
      await adminClient
        .from("profiles")
        .upsert(
          {
            user_id: newUserId,
            tenant_id,
            full_name: display_name || "",
            status: "active",
            onboarding_complete: false,
          },
          { onConflict: "user_id" }
        );

      // Set correct user_roles
      const appRole = (_role === "owner" || _role === "admin") ? "admin" : "user";
      await adminClient
        .from("user_roles")
        .upsert(
          { user_id: newUserId, role: appRole },
          { onConflict: "user_id,role" }
        );
    }

    // 4. Audit
    await adminClient.from("tenant_user_audit_log").insert({
      tenant_id,
      actor_auth_user_id: caller.id,
      action: "invited_by_super_admin",
      target_email: _email,
      meta: { role: _role, display_name },
    });

    return new Response(
      JSON.stringify({ ok: true, message: "Invitation email sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
