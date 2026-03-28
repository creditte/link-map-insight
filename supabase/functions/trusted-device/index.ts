import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function parseUserAgent(ua: string): string {
  if (!ua) return "Unknown Device";
  const browser = ua.match(/(Chrome|Safari|Firefox|Edge|Opera|MSIE|Trident)/i)?.[1] || "Browser";
  const os = ua.match(/(Windows|Mac OS X|Linux|Android|iPhone|iPad)/i)?.[1] || "OS";
  return `${browser} on ${os}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const action = body.action;

    // ── REGISTER: create a trusted device record ─────────────────
    if (action === "register") {
      const rawToken = crypto.randomUUID() + "-" + crypto.randomUUID();
      const tokenHash = await sha256(rawToken);
      const clientIp = getClientIp(req);
      const userAgent = req.headers.get("user-agent") || "";
      const deviceLabel = parseUserAgent(userAgent);
      const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

      await supabaseAdmin.from("trusted_devices").insert({
        user_id: user.id,
        token_hash: tokenHash,
        ip_address: clientIp,
        user_agent: userAgent,
        device_label: deviceLabel,
        expires_at: expiresAt,
      });

      return new Response(
        JSON.stringify({
          trusted_device_token: rawToken,
          expires_at: expiresAt,
          device_label: deviceLabel,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── VALIDATE: check if a trusted device token is valid ───────
    if (action === "validate") {
      const deviceToken = body.device_token;
      if (!deviceToken) {
        return new Response(
          JSON.stringify({ trusted: false, reason: "no_token" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenHash = await sha256(deviceToken);
      const clientIp = getClientIp(req);
      const userAgent = req.headers.get("user-agent") || "";

      const { data: device } = await supabaseAdmin
        .from("trusted_devices")
        .select("*")
        .eq("user_id", user.id)
        .eq("token_hash", tokenHash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!device) {
        return new Response(
          JSON.stringify({ trusted: false, reason: "not_found_or_expired" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check IP match
      if (device.ip_address !== clientIp) {
        return new Response(
          JSON.stringify({ trusted: false, reason: "ip_mismatch" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check user agent match (normalize whitespace for comparison)
      const storedUA = (device.user_agent || "").trim().toLowerCase();
      const currentUA = userAgent.trim().toLowerCase();
      if (storedUA !== currentUA) {
        return new Response(
          JSON.stringify({ trusted: false, reason: "ua_mismatch" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Valid! Update last_used_at
      await supabaseAdmin
        .from("trusted_devices")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", device.id);

      return new Response(
        JSON.stringify({ trusted: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── REVOKE-ALL: remove all trusted devices for the user ─────
    if (action === "revoke-all") {
      const { data: deleted } = await supabaseAdmin
        .from("trusted_devices")
        .delete()
        .eq("user_id", user.id)
        .select("id");

      return new Response(
        JSON.stringify({ revoked: deleted?.length ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── REVOKE: remove a single trusted device ──────────────────
    if (action === "revoke") {
      const deviceId = body.device_id;
      if (!deviceId) throw new Error("device_id required");

      await supabaseAdmin
        .from("trusted_devices")
        .delete()
        .eq("id", deviceId)
        .eq("user_id", user.id);

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── LIST: list all trusted devices for the user ─────────────
    if (action === "list") {
      const { data: devices } = await supabaseAdmin
        .from("trusted_devices")
        .select("id, device_label, ip_address, created_at, last_used_at, expires_at")
        .eq("user_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .order("last_used_at", { ascending: false });

      return new Response(
        JSON.stringify({ devices: devices ?? [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
