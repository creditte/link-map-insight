import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const frontendUrl = Deno.env.get("FRONTEND_URL") || supabaseUrl;

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

    // 2. Send magic link / invite email via Supabase Auth admin API
    const { data: inviteData, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(_email, {
        data: { full_name: display_name || "" },
        redirectTo: frontendUrl,
      });

    if (inviteError) {
      // If user already exists, send a magic link instead
      if (inviteError.message?.includes("already been registered")) {
        const { error: magicError } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: _email,
          options: { redirectTo: frontendUrl },
        });
        if (magicError) {
          return new Response(
            JSON.stringify({ error: `User exists but magic link failed: ${magicError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ ok: true, message: "User already registered. Magic link sent." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Audit
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
