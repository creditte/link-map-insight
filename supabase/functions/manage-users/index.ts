import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
      const { error: authErr } = await adminClient.auth.admin.inviteUserByEmail(
        email.trim().toLowerCase(),
        { data: { display_name: display_name || "" } }
      );
      // If already a user, generate magic link instead
      if (authErr && authErr.message?.includes("already been registered")) {
        const { error: mlErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: email.trim().toLowerCase(),
        });
        if (mlErr) console.error("Magic link error:", mlErr.message);
      } else if (authErr) {
        console.error("Invite auth error:", authErr.message);
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
        const { error: mlErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        if (mlErr) console.error("Magic link error:", mlErr.message);
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
        const { error: mlErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        if (mlErr) console.error("Magic link error:", mlErr.message);
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
      const { data: callerTu } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("tenant_id", tenant_id)
        .eq("auth_user_id", callingUser.id)
        .eq("status", "active")
        .single();

      if (callerTu?.role !== "owner") return json({ error: "Only owners can manage integration access" }, 403);

      // Verify target is an admin
      const { data: targetTu } = await adminClient
        .from("tenant_users")
        .select("role")
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (targetTu?.role !== "admin") return json({ error: "Integration access can only be granted to admin users" }, 400);

      const { error: updateErr } = await adminClient
        .from("tenant_users")
        .update({ can_manage_integrations: !!grant })
        .eq("id", tenant_user_id)
        .eq("tenant_id", tenant_id);

      if (updateErr) return json({ error: updateErr.message }, 400);

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
