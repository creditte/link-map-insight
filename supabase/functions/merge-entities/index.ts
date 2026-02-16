import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MergeRequest {
  primary_entity_id: string;
  merged_entity_ids: string[];
  structure_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: MergeRequest = await req.json();
    const { primary_entity_id, merged_entity_ids, structure_id } = body;

    if (!primary_entity_id || !merged_entity_ids?.length) {
      return new Response(JSON.stringify({ error: "Missing primary_entity_id or merged_entity_ids" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for atomic operations
    const admin = createClient(supabaseUrl, serviceKey);

    // Get user's tenant
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = profile.tenant_id;

    // Verify all entities belong to this tenant and same type
    const allIds = [primary_entity_id, ...merged_entity_ids];
    const { data: entities } = await admin
      .from("entities")
      .select("id, entity_type, name")
      .in("id", allIds)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);

    if (!entities || entities.length !== allIds.length) {
      return new Response(JSON.stringify({ error: "Some entities not found or wrong tenant" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const types = new Set(entities.map((e) => e.entity_type));
    if (types.size > 1) {
      return new Response(JSON.stringify({ error: "Cannot merge entities of different types" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const primaryEntity = entities.find((e) => e.id === primary_entity_id)!;
    let relationshipsRepointed = 0;
    let relationshipsDeduped = 0;

    for (const mergedId of merged_entity_ids) {
      // Get all active relationships for the merged entity
      const { data: mergedRels } = await admin
        .from("relationships")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`from_entity_id.eq.${mergedId},to_entity_id.eq.${mergedId}`);

      // Get existing relationships for primary entity for dedup checks
      const { data: primaryRels } = await admin
        .from("relationships")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`from_entity_id.eq.${primary_entity_id},to_entity_id.eq.${primary_entity_id}`);

      const primaryRelKeys = new Map<string, any>();
      for (const r of primaryRels ?? []) {
        const key = `${r.from_entity_id}|${r.to_entity_id}|${r.relationship_type}`;
        primaryRelKeys.set(key, r);
      }

      for (const rel of mergedRels ?? []) {
        const newFrom = rel.from_entity_id === mergedId ? primary_entity_id : rel.from_entity_id;
        const newTo = rel.to_entity_id === mergedId ? primary_entity_id : rel.to_entity_id;

        // Skip self-referencing relationships
        if (newFrom === newTo) {
          await admin
            .from("relationships")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", rel.id);
          relationshipsDeduped++;
          continue;
        }

        const key = `${newFrom}|${newTo}|${rel.relationship_type}`;
        const existing = primaryRelKeys.get(key);

        if (existing) {
          // Collision: merge ownership fields, soft-delete the duplicate
          const mergedOwnership: Record<string, any> = {};
          if (existing.ownership_percent == null && rel.ownership_percent != null) {
            mergedOwnership.ownership_percent = rel.ownership_percent;
          }
          if (existing.ownership_units == null && rel.ownership_units != null) {
            mergedOwnership.ownership_units = rel.ownership_units;
          }
          if (existing.ownership_class == null && rel.ownership_class != null) {
            mergedOwnership.ownership_class = rel.ownership_class;
          }

          // Update existing with merged fields if any
          if (Object.keys(mergedOwnership).length > 0) {
            await admin
              .from("relationships")
              .update(mergedOwnership)
              .eq("id", existing.id);
          }

          // Soft-delete the duplicate relationship
          await admin
            .from("relationships")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", rel.id);
          relationshipsDeduped++;
        } else {
          // Re-point relationship
          await admin
            .from("relationships")
            .update({ from_entity_id: newFrom, to_entity_id: newTo })
            .eq("id", rel.id);
          relationshipsRepointed++;

          // Track for further dedup
          primaryRelKeys.set(key, { ...rel, from_entity_id: newFrom, to_entity_id: newTo });
        }
      }

      // Fix structure_entities: add primary where merged existed
      const { data: mergedStructLinks } = await admin
        .from("structure_entities")
        .select("structure_id")
        .eq("entity_id", mergedId);

      const { data: primaryStructLinks } = await admin
        .from("structure_entities")
        .select("structure_id")
        .eq("entity_id", primary_entity_id);

      const primaryStructs = new Set((primaryStructLinks ?? []).map((l) => l.structure_id));

      for (const link of mergedStructLinks ?? []) {
        if (!primaryStructs.has(link.structure_id)) {
          await admin
            .from("structure_entities")
            .insert({ structure_id: link.structure_id, entity_id: primary_entity_id });
        }
      }

      // Remove merged entity's structure links
      await admin
        .from("structure_entities")
        .delete()
        .eq("entity_id", mergedId);

      // Fix structure_relationships: remove refs to soft-deleted relationships
      // (soft-deleted rels are already handled above)

      // Soft-delete merged entity
      await admin
        .from("entities")
        .update({
          deleted_at: new Date().toISOString(),
          merged_into_entity_id: primary_entity_id,
        })
        .eq("id", mergedId);

      // Write entity_merges record
      await admin.from("entity_merges").insert({
        tenant_id: tenantId,
        structure_id: structure_id || null,
        primary_entity_id: primary_entity_id,
        merged_entity_id: mergedId,
        merged_by: user.id,
      });
    }

    // Write audit_log entry
    await admin.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: "entity_merge",
      entity_type: "entity",
      entity_id: primary_entity_id,
      before_state: {
        merged_entity_ids,
        merged_names: merged_entity_ids.map(
          (id) => entities.find((e) => e.id === id)?.name
        ),
      },
      after_state: {
        primary_entity_id,
        primary_name: primaryEntity.name,
        relationships_repointed: relationshipsRepointed,
        relationships_deduped: relationshipsDeduped,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        primary_entity_id,
        primary_name: primaryEntity.name,
        merged_count: merged_entity_ids.length,
        relationships_repointed: relationshipsRepointed,
        relationships_deduped: relationshipsDeduped,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Merge error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
