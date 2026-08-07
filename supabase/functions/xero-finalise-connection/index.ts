import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendXpmWelcomeEmail } from "../_shared/xpm-welcome-email.ts";

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
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const selectionToken: string | undefined = body?.selection_token;
    const xeroTenantId: string | undefined = body?.xero_tenant_id;
    if (!selectionToken || !xeroTenantId) {
      return new Response(JSON.stringify({ error: "Missing selection_token or xero_tenant_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending, error: pendingErr } = await service
      .from("xero_oauth_states")
      .select("id, user_id, created_at, used, pending_link")
      .eq("selection_token", selectionToken)
      .eq("flow", "link_select")
      .maybeSingle();

    if (pendingErr || !pending) {
      return new Response(JSON.stringify({ error: "Selection expired. Please reconnect to Xero." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pending.user_id !== userId || pending.used) {
      return new Response(JSON.stringify({ error: "Selection expired. Please reconnect to Xero." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Date.now() - new Date(pending.created_at).getTime() > 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: "Selection expired. Please reconnect to Xero." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const link = pending.pending_link as {
      access_token: string;
      refresh_token: string;
      expires_at: string;
      connected_by_email: string | null;
      tenant_id: string;
      organisations: Array<{ id: string; name: string }>;
    };

    const chosen = link.organisations.find((o) => o.id === xeroTenantId);
    if (!chosen) {
      return new Response(JSON.stringify({ error: "That organisation isn't available on this authorisation." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upsertErr } = await service
      .from("xero_connections")
      .upsert(
        {
          user_id: userId,
          tenant_id: link.tenant_id,
          xero_tenant_id: chosen.id,
          xero_org_name: chosen.name,
          connected_by_email: link.connected_by_email,
          access_token: link.access_token,
          refresh_token: link.refresh_token,
          expires_at: link.expires_at,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tenant_id" },
      );

    if (upsertErr) {
      console.error("[xero-finalise-connection] upsert failed:", upsertErr);
      return new Response(JSON.stringify({ error: "Couldn't save the Xero connection. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean up all pending states for this user
    await service.from("xero_oauth_states").delete().eq("user_id", userId);

    // XPM is connected — this is when the firm can actually use strukcha.
    await sendXpmWelcomeEmail(service, link.tenant_id);

    return new Response(
      JSON.stringify({ ok: true, xero_tenant_id: chosen.id, xero_org_name: chosen.name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("xero-finalise-connection error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
