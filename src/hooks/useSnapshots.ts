import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

export interface Snapshot {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  created_by: string;
  structure_id: string;
}

export interface SnapshotData {
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  positions: Map<string, { x: number; y: number }>;
}

export function useSnapshots(structureId: string | undefined) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSnapshots = useCallback(async () => {
    if (!structureId) return;
    setLoading(true);
    const { data } = await supabase
      .from("structure_snapshots")
      .select("id, name, description, created_at, created_by, structure_id")
      .eq("structure_id", structureId)
      .order("created_at", { ascending: false });
    setSnapshots((data as Snapshot[]) ?? []);
    setLoading(false);
  }, [structureId]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  return { snapshots, loading, reload: loadSnapshots };
}

export async function loadSnapshotData(snapshotId: string): Promise<SnapshotData> {
  const [entResult, relResult] = await Promise.all([
    supabase
      .from("snapshot_entities")
      .select("id, entity_id, name, entity_type, abn, acn, is_operating_entity, is_trustee_company, position_x, position_y")
      .eq("snapshot_id", snapshotId),
    supabase
      .from("snapshot_relationships")
      .select("id, from_entity_snapshot_id, to_entity_snapshot_id, relationship_type, ownership_percent, ownership_units, ownership_class")
      .eq("snapshot_id", snapshotId),
  ]);

  const snapshotEntities = entResult.data ?? [];
  const snapshotRels = relResult.data ?? [];

  const positions = new Map<string, { x: number; y: number }>();
  const entities: EntityNode[] = snapshotEntities.map((se: any) => {
    if (se.position_x != null && se.position_y != null) {
      positions.set(se.id, { x: se.position_x, y: se.position_y });
    }
    return {
      id: se.id, // Use snapshot entity ID as the node ID
      name: se.name,
      entity_type: se.entity_type,
      xpm_uuid: null,
      abn: se.abn,
      acn: se.acn,
      is_operating_entity: se.is_operating_entity,
      is_trustee_company: se.is_trustee_company,
      created_at: "",
    };
  });

  const relationships: RelationshipEdge[] = snapshotRels.map((sr: any) => ({
    id: sr.id,
    from_entity_id: sr.from_entity_snapshot_id,
    to_entity_id: sr.to_entity_snapshot_id,
    relationship_type: sr.relationship_type,
    source_data: "snapshot",
    ownership_percent: sr.ownership_percent,
    ownership_units: sr.ownership_units,
    ownership_class: sr.ownership_class,
    created_at: "",
  }));

  return { entities, relationships, positions };
}

export async function createSnapshot(
  structureId: string,
  name: string,
  description?: string
): Promise<{ snapshot_id: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("create-snapshot", {
    body: { structure_id: structureId, name, description },
  });

  if (response.error) {
    throw new Error(response.error.message || "Failed to create snapshot");
  }

  return response.data as { snapshot_id: string };
}

export async function getSnapshotCount(structureIds: string[]): Promise<Map<string, number>> {
  if (structureIds.length === 0) return new Map();
  const { data } = await supabase
    .from("structure_snapshots")
    .select("structure_id")
    .in("structure_id", structureIds);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.structure_id, (counts.get(row.structure_id) ?? 0) + 1);
  }
  return counts;
}
