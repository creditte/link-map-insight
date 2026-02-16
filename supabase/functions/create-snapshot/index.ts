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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth check
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

    const { structure_id, name, description } = await req.json();
    if (!structure_id || !name) {
      return new Response(JSON.stringify({ error: "structure_id and name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client for atomic operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's tenant
    const { data: profile } = await adminClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify structure belongs to tenant
    const { data: structure } = await adminClient
      .from("structures")
      .select("id, tenant_id, layout_mode")
      .eq("id", structure_id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!structure) {
      return new Response(JSON.stringify({ error: "Structure not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Create snapshot record
    const { data: snapshot, error: snapErr } = await adminClient
      .from("structure_snapshots")
      .insert({
        tenant_id: profile.tenant_id,
        structure_id,
        name,
        description: description || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (snapErr || !snapshot) {
      throw new Error(`Failed to create snapshot: ${snapErr?.message}`);
    }

    // 2) Fetch structure entities with positions
    const { data: seRows } = await adminClient
      .from("structure_entities")
      .select("entity_id, position_x, position_y")
      .eq("structure_id", structure_id);

    const entityIds = (seRows ?? []).map((r: any) => r.entity_id);
    if (entityIds.length === 0) {
      // Empty structure snapshot
      await adminClient.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: "snapshot_created",
        entity_type: "structure",
        entity_id: structure_id,
        after_state: { snapshot_id: snapshot.id, snapshot_name: name },
      });

      return new Response(JSON.stringify({ snapshot_id: snapshot.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch live entities
    const { data: entities } = await adminClient
      .from("entities")
      .select("id, name, entity_type, abn, acn, is_operating_entity, is_trustee_company")
      .in("id", entityIds)
      .is("deleted_at", null);

    // Build position map
    const posMap = new Map<string, { x: number | null; y: number | null }>();
    for (const row of seRows ?? []) {
      posMap.set(row.entity_id, { x: row.position_x, y: row.position_y });
    }

    // 3) Insert snapshot entities
    const snapshotEntities = (entities ?? []).map((e: any) => {
      const pos = posMap.get(e.id);
      return {
        snapshot_id: snapshot.id,
        entity_id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        abn: e.abn,
        acn: e.acn,
        is_operating_entity: e.is_operating_entity,
        is_trustee_company: e.is_trustee_company,
        position_x: pos?.x ?? null,
        position_y: pos?.y ?? null,
      };
    });

    const { data: insertedEntities, error: entErr } = await adminClient
      .from("snapshot_entities")
      .insert(snapshotEntities)
      .select("id, entity_id");

    if (entErr) {
      throw new Error(`Failed to insert snapshot entities: ${entErr.message}`);
    }

    // Build mapping: live entity_id → snapshot_entity_id
    const entityToSnapshotMap = new Map<string, string>();
    for (const se of insertedEntities ?? []) {
      entityToSnapshotMap.set(se.entity_id, se.id);
    }

    // 4) Fetch live relationships for this structure
    const { data: srRows } = await adminClient
      .from("structure_relationships")
      .select("relationship_id")
      .eq("structure_id", structure_id);

    const relIds = (srRows ?? []).map((r: any) => r.relationship_id);

    if (relIds.length > 0) {
      const { data: rels } = await adminClient
        .from("relationships")
        .select("id, from_entity_id, to_entity_id, relationship_type, ownership_percent, ownership_units, ownership_class")
        .in("id", relIds)
        .is("deleted_at", null);

      const snapshotRels = (rels ?? [])
        .filter((r: any) => entityToSnapshotMap.has(r.from_entity_id) && entityToSnapshotMap.has(r.to_entity_id))
        .map((r: any) => ({
          snapshot_id: snapshot.id,
          from_entity_snapshot_id: entityToSnapshotMap.get(r.from_entity_id)!,
          to_entity_snapshot_id: entityToSnapshotMap.get(r.to_entity_id)!,
          relationship_type: r.relationship_type,
          ownership_percent: r.ownership_percent,
          ownership_units: r.ownership_units,
          ownership_class: r.ownership_class,
        }));

      if (snapshotRels.length > 0) {
        const { error: relErr } = await adminClient
          .from("snapshot_relationships")
          .insert(snapshotRels);

        if (relErr) {
          throw new Error(`Failed to insert snapshot relationships: ${relErr.message}`);
        }
      }
    }

    // 5) Audit log
    await adminClient.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: "snapshot_created",
      entity_type: "structure",
      entity_id: structure_id,
      after_state: {
        snapshot_id: snapshot.id,
        snapshot_name: name,
        entity_count: snapshotEntities.length,
        relationship_count: relIds.length,
      },
    });

    return new Response(JSON.stringify({ snapshot_id: snapshot.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("create-snapshot error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
