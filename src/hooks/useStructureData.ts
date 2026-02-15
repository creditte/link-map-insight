import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EntityNode {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
  abn: string | null;
  acn: string | null;
  is_operating_entity: boolean;
  created_at: string;
}

export interface RelationshipEdge {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  source_data: string;
  ownership_percent: number | null;
  ownership_units: number | null;
  ownership_class: string | null;
  created_at: string;
}

const FAMILY_TYPES = new Set(["spouse", "parent", "child"]);

export function useStructureData(structureId: string | undefined) {
  const [entities, setEntities] = useState<EntityNode[]>([]);
  const [relationships, setRelationships] = useState<RelationshipEdge[]>([]);
  const [structureName, setStructureName] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!structureId) return;

    async function load() {
      setLoading(true);

      const { data: struct } = await supabase
        .from("structures")
        .select("name")
        .eq("id", structureId)
        .single();
      setStructureName(struct?.name ?? "");

      const { data: seRows } = await supabase
        .from("structure_entities")
        .select("entity_id")
        .eq("structure_id", structureId);

      const entityIds = (seRows ?? []).map((r) => r.entity_id);
      if (entityIds.length === 0) {
        setEntities([]);
        setRelationships([]);
        setLoading(false);
        return;
      }

      const { data: entitiesData } = await supabase
        .from("entities")
        .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, created_at")
        .in("id", entityIds)
        .is("deleted_at", null);
      setEntities((entitiesData as EntityNode[]) ?? []);

      const { data: srRows } = await supabase
        .from("structure_relationships")
        .select("relationship_id")
        .eq("structure_id", structureId);

      const relIds = (srRows ?? []).map((r) => r.relationship_id);
      if (relIds.length > 0) {
        const { data: relData } = await supabase
          .from("relationships")
          .select("id, from_entity_id, to_entity_id, relationship_type, source, ownership_percent, ownership_units, ownership_class, created_at")
          .in("id", relIds)
          .is("deleted_at", null);
        setRelationships(
          (relData ?? []).map((r) => ({
            id: r.id,
            from_entity_id: r.from_entity_id,
            to_entity_id: r.to_entity_id,
            relationship_type: r.relationship_type,
            source_data: r.source,
            ownership_percent: r.ownership_percent,
            ownership_units: r.ownership_units,
            ownership_class: r.ownership_class,
            created_at: r.created_at,
          }))
        );
      } else {
        setRelationships([]);
      }

      setLoading(false);
    }

    load();
  }, [structureId, version]);

  return { entities, relationships, structureName, loading, reload };
}

const OWNERSHIP_VIEW_TYPES = new Set(["shareholder", "beneficiary", "partner", "member"]);
const CONTROL_VIEW_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

export function useFilteredGraph(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  options: {
    search: string;
    showFamily: boolean;
    filterRelType: string;
    depth: number;
    selectedEntityId: string | null;
    viewMode: string;
  }
) {
  return useMemo(() => {
    const { search, showFamily, filterRelType, depth, selectedEntityId, viewMode } = options;

    // Filter relationships by view mode first
    let filteredRels = relationships.filter((r) => {
      if (viewMode === "ownership" && !OWNERSHIP_VIEW_TYPES.has(r.relationship_type)) return false;
      if (viewMode === "control" && !CONTROL_VIEW_TYPES.has(r.relationship_type)) return false;
      if (!showFamily && FAMILY_TYPES.has(r.relationship_type)) return false;
      if (filterRelType && r.relationship_type !== filterRelType) return false;
      return true;
    });

    // If an entity is selected, do BFS for depth hops
    let visibleEntityIds: Set<string>;
    if (selectedEntityId) {
      visibleEntityIds = new Set<string>();
      let frontier = new Set([selectedEntityId]);
      for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set<string>();
        for (const eid of frontier) {
          visibleEntityIds.add(eid);
          for (const rel of filteredRels) {
            if (rel.from_entity_id === eid && !visibleEntityIds.has(rel.to_entity_id)) {
              nextFrontier.add(rel.to_entity_id);
            }
            if (rel.to_entity_id === eid && !visibleEntityIds.has(rel.from_entity_id)) {
              nextFrontier.add(rel.from_entity_id);
            }
          }
        }
        frontier = nextFrontier;
      }
      for (const eid of frontier) visibleEntityIds.add(eid);
    } else {
      visibleEntityIds = new Set(entities.map((e) => e.id));
    }

    // Search filter
    let visibleEntities = entities.filter((e) => visibleEntityIds.has(e.id));
    if (search) {
      const q = search.toLowerCase();
      const matchIds = new Set(
        visibleEntities.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id)
      );
      const connectedIds = new Set(matchIds);
      for (const rel of filteredRels) {
        if (matchIds.has(rel.from_entity_id)) connectedIds.add(rel.to_entity_id);
        if (matchIds.has(rel.to_entity_id)) connectedIds.add(rel.from_entity_id);
      }
      visibleEntities = visibleEntities.filter((e) => connectedIds.has(e.id));
    }

    const finalEntityIds = new Set(visibleEntities.map((e) => e.id));
    filteredRels = filteredRels.filter(
      (r) => finalEntityIds.has(r.from_entity_id) && finalEntityIds.has(r.to_entity_id)
    );

    return { visibleEntities, visibleRelationships: filteredRels };
  }, [entities, relationships, options.search, options.showFamily, options.filterRelType, options.depth, options.selectedEntityId, options.viewMode]);
}
