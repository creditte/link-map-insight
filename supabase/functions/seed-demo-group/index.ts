import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEMO_STRUCTURE_NAME = "Rogan Family Group (Demo)";

/** Sample entities for the demo group. Keys are local references used by the edges below. */
const DEMO_ENTITIES = [
  { ref: "trust", name: "Rogan Family Trust", entity_type: "trust_discretionary", trust_subtype: "Discretionary", x: 0, y: 0 },
  { ref: "trustee", name: "Rogan Investments Pty Ltd", entity_type: "Company", acn: "612 345 678", is_trustee_company: true, x: -260, y: -180 },
  { ref: "opco", name: "Rogan Plumbing Pty Ltd", entity_type: "Company", acn: "645 987 321", is_operating_entity: true, x: 0, y: 200 },
  { ref: "michael", name: "Michael Rogan", entity_type: "Individual", x: -420, y: -380 },
  { ref: "sarah", name: "Sarah Rogan", entity_type: "Individual", x: -100, y: -380 },
] as const;

const DEMO_RELATIONSHIPS = [
  { from: "michael", to: "trustee", type: "director" },
  { from: "sarah", to: "trustee", type: "director" },
  { from: "michael", to: "trustee", type: "shareholder", ownership_percent: 50 },
  { from: "sarah", to: "trustee", type: "shareholder", ownership_percent: 50 },
  { from: "trustee", to: "trust", type: "trustee" },
  { from: "michael", to: "trust", type: "appointer" },
  { from: "michael", to: "trust", type: "beneficiary" },
  { from: "sarah", to: "trust", type: "beneficiary" },
  { from: "trust", to: "opco", type: "shareholder", ownership_percent: 100 },
  { from: "michael", to: "opco", type: "director" },
  { from: "michael", to: "sarah", type: "spouse" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await service.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { data: profile } = await service
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "No workspace found for this user." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tenantId = profile.tenant_id as string;

    // Idempotent: reuse the existing demo structure when it's already there.
    const { data: existing } = await service
      .from("structures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", DEMO_STRUCTURE_NAME)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ structure_id: existing.id, created: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: structure, error: structureErr } = await service
      .from("structures")
      .insert({ tenant_id: tenantId, name: DEMO_STRUCTURE_NAME, source: "manual", layout_mode: "manual" })
      .select("id")
      .single();
    if (structureErr || !structure) {
      const message = structureErr?.message ?? "Couldn't create the demo structure.";
      console.error("[seed-demo-group] structure insert failed:", message);
      return new Response(
        JSON.stringify({
          error: /limit|subscription/i.test(message)
            ? message
            : "Couldn't create the demo structure. Please try again.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const structureId = structure.id as string;

    const { data: insertedEntities, error: entityErr } = await service
      .from("entities")
      .insert(
        DEMO_ENTITIES.map((e) => ({
          tenant_id: tenantId,
          name: e.name,
          entity_type: e.entity_type,
          trust_subtype: (e as { trust_subtype?: string }).trust_subtype ?? null,
          acn: (e as { acn?: string }).acn ?? null,
          source: "manual",
          verified: false,
          is_operating_entity: Boolean((e as { is_operating_entity?: boolean }).is_operating_entity),
          is_trustee_company: Boolean((e as { is_trustee_company?: boolean }).is_trustee_company),
        })),
      )
      .select("id, name");
    if (entityErr || !insertedEntities) {
      console.error("[seed-demo-group] entity insert failed:", entityErr);
      await service.from("structures").delete().eq("id", structureId);
      return new Response(JSON.stringify({ error: "Couldn't create the demo entities." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const idByRef = new Map<string, string>();
    for (const demo of DEMO_ENTITIES) {
      const match = insertedEntities.find((row) => row.name === demo.name);
      if (match) idByRef.set(demo.ref, match.id as string);
    }

    await service.from("structure_entities").insert(
      DEMO_ENTITIES.map((e) => ({
        structure_id: structureId,
        entity_id: idByRef.get(e.ref)!,
        position_x: e.x,
        position_y: e.y,
      })),
    );

    const { data: insertedRels, error: relErr } = await service
      .from("relationships")
      .insert(
        DEMO_RELATIONSHIPS.map((r) => ({
          tenant_id: tenantId,
          from_entity_id: idByRef.get(r.from)!,
          to_entity_id: idByRef.get(r.to)!,
          relationship_type: r.type,
          ownership_percent: (r as { ownership_percent?: number }).ownership_percent ?? null,
          source: "manual",
          confidence: "confirmed",
        })),
      )
      .select("id");
    if (relErr) {
      console.error("[seed-demo-group] relationship insert failed:", relErr);
    } else if (insertedRels) {
      await service.from("structure_relationships").insert(
        insertedRels.map((r) => ({ structure_id: structureId, relationship_id: r.id })),
      );
    }

    return new Response(JSON.stringify({ structure_id: structureId, created: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("seed-demo-group error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
