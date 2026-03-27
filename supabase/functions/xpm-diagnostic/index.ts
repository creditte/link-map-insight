import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function refreshAccessToken(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.expires_at);
  const currentAccessToken = await decryptToken(connection.access_token);

  if (expiresAt.getTime() - now.getTime() > 120_000) {
    return currentAccessToken;
  }

  console.log("[xpm-diag] Token expired, refreshing...");
  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
  const currentRefreshToken = await decryptToken(connection.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const encryptedAccessToken = await encryptToken(tokens.access_token);
  const encryptedRefreshToken = await encryptToken(tokens.refresh_token);

  await supabase
    .from("xero_connections")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

async function tryEndpoint(
  url: string,
  accessToken: string,
  xeroTenantId: string,
): Promise<{ url: string; status: number; ok: boolean; contentType: string; body: any; truncated?: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
        Accept: "application/json",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let body: any;

    try {
      body = JSON.parse(text);
    } catch {
      // If it's XML or other, just return first 500 chars
      body = text.substring(0, 500);
    }

    // Truncate large responses
    const bodyStr = JSON.stringify(body);
    const truncated = bodyStr.length > 3000;
    if (truncated && typeof body === "object" && body !== null) {
      // For arrays, show count + first 2 items
      for (const key of Object.keys(body)) {
        if (Array.isArray(body[key]) && body[key].length > 2) {
          const count = body[key].length;
          body[key] = { _count: count, _sample: body[key].slice(0, 2) };
        }
      }
    }

    return { url, status: res.status, ok: res.ok, contentType, body, truncated };
  } catch (err) {
    return { url, status: 0, ok: false, contentType: "", body: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant
    const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Xero connection
    const { data: connections } = await supabase
      .from("xero_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("connected_at", { ascending: false })
      .limit(1);

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ error: "No Xero connection found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connections[0];
    const accessToken = await refreshAccessToken(supabase, connection);
    const xeroTenantId = connection.xero_tenant_id;

    if (!xeroTenantId) {
      return new Response(JSON.stringify({ error: "No xero_tenant_id on connection" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[xpm-diag] Starting endpoint tests...");

    // Test multiple XPM API URL patterns
    const endpointsToTest = [
      // XPM 3.1 paths
      "https://api.xero.com/practicemanager/3.1/client.api/list",
      "https://api.xero.com/practicemanager/3.1/client/list",
      "https://api.xero.com/practicemanager/3.1/clients",
      // XPM 3.0 paths
      "https://api.xero.com/practicemanager/3.0/client.api/list",
      "https://api.xero.com/practicemanager/3.0/client/list",
      // XPM without version
      "https://api.xero.com/practicemanager/client.api/list",
      // Alternative XPM base
      "https://api.xero.com/xpm/1.0/clients",
      // Client groups
      "https://api.xero.com/practicemanager/3.1/clientgroup.api/list",
      "https://api.xero.com/practicemanager/3.1/clientgroup/list",
      "https://api.xero.com/practicemanager/3.0/clientgroup.api/list",
      // Staff
      "https://api.xero.com/practicemanager/3.1/staff.api/list",
      "https://api.xero.com/practicemanager/3.1/staff/list",
      "https://api.xero.com/practicemanager/3.0/staff.api/list",
    ];

    const results = [];
    for (const url of endpointsToTest) {
      console.log(`[xpm-diag] Testing: ${url}`);
      const result = await tryEndpoint(url, accessToken, xeroTenantId);
      results.push(result);
      console.log(`[xpm-diag]   → ${result.status} ${result.ok ? "✓" : "✗"}`);
    }

    // Separate successful and failed
    const working = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Also check /connections to see what scopes are authorized
    const connectionsRes = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let connectionsData: any;
    try {
      connectionsData = await connectionsRes.json();
    } catch {
      connectionsData = null;
    }

    return new Response(
      JSON.stringify({
        xeroTenantId,
        xeroOrgName: connection.xero_org_name,
        authorizedConnections: connectionsData,
        workingEndpoints: working,
        failedEndpoints: failed.map((f) => ({
          url: f.url,
          status: f.status,
          body: typeof f.body === "string" ? f.body.substring(0, 200) : f.body,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[xpm-diag] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
