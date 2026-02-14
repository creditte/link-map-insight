import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EntityNode {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
}

export interface RelationshipEdge {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  source_data: string;
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
        .select("id, name, entity_type, xpm_uuid")
        .in("id", entityIds);
      setEntities((entitiesData as EntityNode[]) ?? []);

      const { data: srRows } = await supabase
        .from("structure_relationships")
        .select("relationship_id")
        .eq("structure_id", structureId);

      const relIds = (srRows ?? []).map((r) => r.relationship_id);
      if (relIds.length > 0) {
        const { data: relData } = await supabase
          .from("relationships")
          .select("id, from_entity_id, to_entity_id, relationship_type, source")
          .in("id", relIds);
        setRelationships(
          (relData ?? []).map((r) => ({
            id: r.id,
            from_entity_id: r.from_entity_id,
            to_entity_id: r.to_entity_id,
            relationship_type: r.relationship_type,
            source_data: r.source,
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

export function useFilteredGraph(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  options: {
    search: string;
    showFamily: boolean;
    filterRelType: string;
    depth: number;
    selectedEntityId: string | null;
  }
) {
  return useMemo(() => {
    const { search, showFamily, filterRelType, depth, selectedEntityId } = options;

    // Filter relationships by type
    let filteredRels = relationships.filter((r) => {
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
      // Add last frontier
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
      // Show matched + their direct connections
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
  }, [entities, relationships, options.search, options.showFamily, options.filterRelType, options.depth, options.selectedEntityId]);
}
