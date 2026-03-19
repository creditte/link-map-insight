import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the calling user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) throw new Error("Unauthorized");

    // Use REST API directly to list factors
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${user.id}/factors`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      }
    );
    const factors = await listRes.json();
    console.log("[reset-totp] Factors:", JSON.stringify(factors));

    const allFactors = Array.isArray(factors) ? factors : (factors?.factors ?? []);
    const totp = allFactors.filter((f: any) => f.factor_type === "totp");

    let removed = 0;
    for (const f of totp) {
      console.log("[reset-totp] Deleting factor:", f.id);
      const delRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${user.id}/factors/${f.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        }
      );
      if (!delRes.ok) {
        const err = await delRes.text();
        console.log("[reset-totp] Delete failed:", err);
        throw new Error(`Failed to delete factor: ${err}`);
      }
      removed++;
    }

    return new Response(JSON.stringify({ ok: true, removed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
