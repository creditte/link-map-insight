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

    const { source_structure_id, snapshot_id, name, scenario_label } = await req.json();

    if (!name) {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!source_structure_id && !snapshot_id) {
      return new Response(JSON.stringify({ error: "source_structure_id or snapshot_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    let parentStructureId: string | null = null;
    let layoutMode = "auto";
    let entitiesData: any[] = [];
    let relationshipsData: any[] = [];
    let auditAction = "scenario_created";
    let auditMeta: Record<string, any> = {};

    if (snapshot_id) {
      // ── Create from snapshot ──
      auditAction = "scenario_created_from_snapshot";

      // Verify snapshot belongs to tenant
      const { data: snap } = await adminClient
        .from("structure_snapshots")
        .select("id, structure_id, tenant_id")
        .eq("id", snapshot_id)
        .eq("tenant_id", profile.tenant_id)
        .single();

      if (!snap) {
        return new Response(JSON.stringify({ error: "Snapshot not found or access denied" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      parentStructureId = snap.structure_id;

      // Check if snapshot has manual positions → use manual mode
      const { data: snapEnts } = await adminClient
        .from("snapshot_entities")
        .select("entity_id, name, entity_type, abn, acn, is_operating_entity, is_trustee_company, position_x, position_y")
        .eq("snapshot_id", snapshot_id);

      const hasPositions = (snapEnts ?? []).some((e: any) => e.position_x != null);
      layoutMode = hasPositions ? "manual" : "auto";

      entitiesData = (snapEnts ?? []).map((e: any) => ({
        live_entity_id: e.entity_id,
        name: e.name,
        entity_type: e.entity_type,
        abn: e.abn,
        acn: e.acn,
        is_operating_entity: e.is_operating_entity,
        is_trustee_company: e.is_trustee_company,
        position_x: e.position_x,
        position_y: e.position_y,
      }));

      // Snapshot relationships reference snapshot_entity IDs, map them back to live entity IDs
      const { data: snapRels } = await adminClient
        .from("snapshot_relationships")
        .select("from_entity_snapshot_id, to_entity_snapshot_id, relationship_type, ownership_percent, ownership_units, ownership_class")
        .eq("snapshot_id", snapshot_id);

      // Build snapshot_entity_id → entity_id map
      const snapEntMap = new Map<string, string>();
      const { data: snapEntsFull } = await adminClient
        .from("snapshot_entities")
        .select("id, entity_id")
        .eq("snapshot_id", snapshot_id);
      for (const se of snapEntsFull ?? []) {
        snapEntMap.set(se.id, se.entity_id);
      }

      relationshipsData = (snapRels ?? []).map((r: any) => ({
        from_entity_id: snapEntMap.get(r.from_entity_snapshot_id) ?? r.from_entity_snapshot_id,
        to_entity_id: snapEntMap.get(r.to_entity_snapshot_id) ?? r.to_entity_snapshot_id,
        relationship_type: r.relationship_type,
        ownership_percent: r.ownership_percent,
        ownership_units: r.ownership_units,
        ownership_class: r.ownership_class,
      }));

      auditMeta = { snapshot_id };

    } else {
      // ── Duplicate live structure ──
      const { data: srcStructure } = await adminClient
        .from("structures")
        .select("id, tenant_id, layout_mode")
        .eq("id", source_structure_id)
        .eq("tenant_id", profile.tenant_id)
        .single();

      if (!srcStructure) {
        return new Response(JSON.stringify({ error: "Structure not found or access denied" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      parentStructureId = source_structure_id;
      layoutMode = srcStructure.layout_mode;

      // Fetch structure entities
      const { data: seRows } = await adminClient
        .from("structure_entities")
        .select("entity_id, position_x, position_y")
        .eq("structure_id", source_structure_id);

      const entityIds = (seRows ?? []).map((r: any) => r.entity_id);
      const posMap = new Map<string, { x: number | null; y: number | null }>();
      for (const row of seRows ?? []) {
        posMap.set(row.entity_id, { x: row.position_x, y: row.position_y });
      }

      if (entityIds.length > 0) {
        const { data: ents } = await adminClient
          .from("entities")
          .select("id, name, entity_type, abn, acn, is_operating_entity, is_trustee_company")
          .in("id", entityIds)
          .is("deleted_at", null);

        entitiesData = (ents ?? []).map((e: any) => {
          const pos = posMap.get(e.id);
          return {
            live_entity_id: e.id,
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

        // Fetch relationships
        const { data: srRows } = await adminClient
          .from("structure_relationships")
          .select("relationship_id")
          .eq("structure_id", source_structure_id);

        const relIds = (srRows ?? []).map((r: any) => r.relationship_id);
        if (relIds.length > 0) {
          const { data: rels } = await adminClient
            .from("relationships")
            .select("id, from_entity_id, to_entity_id, relationship_type, source, ownership_percent, ownership_units, ownership_class")
            .in("id", relIds)
            .is("deleted_at", null);

          relationshipsData = (rels ?? []).map((r: any) => ({
            from_entity_id: r.from_entity_id,
            to_entity_id: r.to_entity_id,
            relationship_type: r.relationship_type,
            source: r.source,
            ownership_percent: r.ownership_percent,
            ownership_units: r.ownership_units,
            ownership_class: r.ownership_class,
          }));
        }
      }

      auditMeta = { source_structure_id };
    }

    // ── Create new structure ──
    const { data: newStructure, error: structErr } = await adminClient
      .from("structures")
      .insert({
        tenant_id: profile.tenant_id,
        name,
        layout_mode: layoutMode,
        parent_structure_id: parentStructureId,
        is_scenario: true,
        scenario_label: scenario_label || null,
      })
      .select("id")
      .single();

    if (structErr || !newStructure) {
      throw new Error(`Failed to create structure: ${structErr?.message}`);
    }

    // ── Copy entities ──
    const liveEntityIds = new Set<string>();
    if (entitiesData.length > 0) {
      // We need to reference the same live entities (they're shared across structures)
      const seInserts = entitiesData.map((e: any) => ({
        structure_id: newStructure.id,
        entity_id: e.live_entity_id,
        position_x: e.position_x,
        position_y: e.position_y,
      }));

      for (const e of entitiesData) liveEntityIds.add(e.live_entity_id);

      const { error: seErr } = await adminClient
        .from("structure_entities")
        .insert(seInserts);

      if (seErr) {
        throw new Error(`Failed to insert structure entities: ${seErr.message}`);
      }
    }

    // ── Copy relationships ──
    if (relationshipsData.length > 0) {
      // For live structure duplication, relationships already exist — just link them
      if (source_structure_id) {
        const { data: srRows } = await adminClient
          .from("structure_relationships")
          .select("relationship_id")
          .eq("structure_id", source_structure_id);

        const srInserts = (srRows ?? []).map((r: any) => ({
          structure_id: newStructure.id,
          relationship_id: r.relationship_id,
        }));

        if (srInserts.length > 0) {
          const { error: srErr } = await adminClient
            .from("structure_relationships")
            .insert(srInserts);

          if (srErr) {
            throw new Error(`Failed to insert structure relationships: ${srErr.message}`);
          }
        }
      } else {
        // From snapshot: need to create new relationship records
        const relInserts = relationshipsData
          .filter((r: any) => liveEntityIds.has(r.from_entity_id) && liveEntityIds.has(r.to_entity_id))
          .map((r: any) => ({
            tenant_id: profile.tenant_id,
            from_entity_id: r.from_entity_id,
            to_entity_id: r.to_entity_id,
            relationship_type: r.relationship_type,
            source: "manual",
            ownership_percent: r.ownership_percent,
            ownership_units: r.ownership_units,
            ownership_class: r.ownership_class,
          }));

        if (relInserts.length > 0) {
          const { data: newRels, error: relErr } = await adminClient
            .from("relationships")
            .insert(relInserts)
            .select("id");

          if (relErr) {
            throw new Error(`Failed to create relationships: ${relErr.message}`);
          }

          const srInserts = (newRels ?? []).map((r: any) => ({
            structure_id: newStructure.id,
            relationship_id: r.id,
          }));

          if (srInserts.length > 0) {
            await adminClient.from("structure_relationships").insert(srInserts);
          }
        }
      }
    }

    // ── Audit log ──
    await adminClient.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: auditAction,
      entity_type: "structure",
      entity_id: newStructure.id,
      after_state: {
        ...auditMeta,
        new_structure_id: newStructure.id,
        scenario_name: name,
        entity_count: entitiesData.length,
        relationship_count: relationshipsData.length,
      },
    });

    return new Response(JSON.stringify({ structure_id: newStructure.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("duplicate-structure error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
