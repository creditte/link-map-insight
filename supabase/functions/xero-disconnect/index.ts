import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    let body: any = {};
    try {
      body = await req.json();
    } catch { /* empty */ }
    const connectionId = body?.connection_id as string | undefined;
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connection_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the connection (need tokens). Verify caller has access via tenant.
    const { data: conn, error: connErr } = await service
      .from("xero_connections")
      .select("id, tenant_id, refresh_token, access_token, xero_tenant_id")
      .eq("id", connectionId)
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorise: caller must be owner/admin of the tenant that owns the connection.
    const { data: membership } = await service
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", conn.tenant_id)
      .eq("auth_user_id", userId)
      .maybeSingle();
    const role = (membership as any)?.role;
    if (role !== "owner" && role !== "admin") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");

    const revokeWarnings: string[] = [];

    // 1) Delete the tenant connection on Xero's side so the app disappears
    //    from the org's Connected Apps list.
    if (conn.access_token && conn.xero_tenant_id) {
      try {
        const res = await fetch(
          `https://api.xero.com/connections/${conn.xero_tenant_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${conn.access_token}` },
          },
        );
        if (!res.ok && res.status !== 404) {
          revokeWarnings.push(`connections_delete_${res.status}`);
        }
      } catch (e) {
        console.error("xero connections delete failed", e);
        revokeWarnings.push("connections_delete_network");
      }
    }

    // 2) Revoke the refresh token so the user's Xero account fully forgets
    //    this app authorisation.
    if (clientId && clientSecret && conn.refresh_token) {
      try {
        const basic = btoa(`${clientId}:${clientSecret}`);
        const res = await fetch("https://identity.xero.com/connect/revocation", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token: conn.refresh_token }).toString(),
        });
        if (!res.ok) {
          revokeWarnings.push(`revoke_${res.status}`);
        }
      } catch (e) {
        console.error("xero revoke failed", e);
        revokeWarnings.push("revoke_network");
      }
    }

    // 3) Remove the local record regardless — the user asked to disconnect.
    const { error: delErr } = await service
      .from("xero_connections")
      .delete()
      .eq("id", connectionId);
    if (delErr) {
      return new Response(JSON.stringify({ error: "Failed to remove connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, warnings: revokeWarnings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("xero-disconnect error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
