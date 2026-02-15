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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify calling user is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callingUser },
    } = await userClient.auth.getUser();
    if (!callingUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: callingUser.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (action === "invite") {
      const { email, role, tenant_id, full_name } = body;

      if (!email || !role || !tenant_id) {
        return new Response(
          JSON.stringify({ error: "email, role, and tenant_id are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create invitation record
      const { data: invitation, error: invError } = await userClient
        .from("invitations")
        .insert({
          tenant_id,
          email,
          role,
          invited_by: callingUser.id,
        })
        .select("id")
        .single();

      if (invError) {
        // Check for duplicate
        if (invError.code === "23505") {
          return new Response(
            JSON.stringify({ error: "An invitation already exists for this email" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw invError;
      }

      // Use Supabase admin API to invite user by email
      const { data: inviteData, error: authError } =
        await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { full_name: full_name || "" },
        });

      if (authError) {
        // Clean up invitation if auth invite fails
        await userClient.from("invitations").delete().eq("id", invitation.id);
        throw authError;
      }

      // Log to audit
      const { data: profile } = await userClient
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", callingUser.id)
        .single();

      if (profile) {
        await adminClient.from("audit_log").insert({
          tenant_id: profile.tenant_id,
          user_id: callingUser.id,
          action: "user_invite",
          entity_type: "user",
          entity_id: invitation.id,
          after_state: { email, role, full_name },
        });
      }

      return new Response(
        JSON.stringify({ success: true, invitation_id: invitation.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "resend_invite") {
      const { email } = body;

      const { error: authError } =
        await adminClient.auth.admin.inviteUserByEmail(email);

      if (authError) throw authError;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "change_role") {
      const { user_id, new_role } = body;

      if (!user_id || !new_role) {
        return new Response(
          JSON.stringify({ error: "user_id and new_role are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get current role
      const { data: currentRoles } = await adminClient
        .from("user_roles")
        .select("id, role")
        .eq("user_id", user_id);

      const oldRole = currentRoles?.[0]?.role;

      // Update role (delete old, insert new)
      await adminClient.from("user_roles").delete().eq("user_id", user_id);
      await adminClient
        .from("user_roles")
        .insert({ user_id, role: new_role });

      // Audit log
      const { data: profile } = await userClient
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", callingUser.id)
        .single();

      if (profile) {
        await adminClient.from("audit_log").insert({
          tenant_id: profile.tenant_id,
          user_id: callingUser.id,
          action: "user_role_change",
          entity_type: "user",
          entity_id: user_id,
          before_state: { role: oldRole },
          after_state: { role: new_role },
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "toggle_status") {
      const { user_id, new_status } = body;

      if (!user_id || !new_status) {
        return new Response(
          JSON.stringify({ error: "user_id and new_status are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update profile status
      const { error } = await adminClient
        .from("profiles")
        .update({ status: new_status })
        .eq("user_id", user_id);

      if (error) throw error;

      // If disabling, also ban from auth
      if (new_status === "disabled") {
        await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "876600h", // ~100 years
        });
      } else if (new_status === "active") {
        await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "none",
        });
      }

      // Audit
      const { data: profile } = await userClient
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", callingUser.id)
        .single();

      if (profile) {
        await adminClient.from("audit_log").insert({
          tenant_id: profile.tenant_id,
          user_id: callingUser.id,
          action: new_status === "disabled" ? "user_disable" : "user_enable",
          entity_type: "user",
          entity_id: user_id,
          after_state: { status: new_status },
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("invite-user error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
