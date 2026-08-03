// Shared authorization for cron-invoked functions.
//
// pg_cron posts with the service-role JWT held in vault, which is not always
// byte-identical to SUPABASE_SERVICE_ROLE_KEY (signing-keys projects can expose a
// different secret key format). So accept either an exact match against the
// service key or a JWT whose `role` claim is `service_role`.

function parseJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** True when the request carries service-role authority. */
export function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (serviceKey && token === serviceKey) return true;
  return parseJwtClaims(token)?.role === "service_role";
}
