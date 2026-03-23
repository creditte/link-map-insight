import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
type LayoutStrategy = "auto" | "manual";

// ── Types ──────────────────────────────────────────────────────────

export interface EntityNode {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
  abn: string | null;
  acn: string | null;
  is_operating_entity: boolean;
  is_trustee_company: boolean;
  is_investment_company: boolean;
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

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  entity_id?: string;
  entity_name?: string;
  relationship_id?: string;
  details?: any;
}

export interface StructureHealth {
  score: number;
  status: "good" | "warning" | "critical";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

// ── Constants ──────────────────────────────────────────────────────

const FAMILY_TYPES = new Set(["spouse", "parent", "child"]);
const OWNERSHIP_VIEW_TYPES = new Set(["shareholder", "beneficiary", "partner", "member"]);
const CONTROL_VIEW_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

// ── Hook: useStructureData ─────────────────────────────────────────

export function useStructureData(structureId: string | undefined) {
  const [entities, setEntities] = useState<EntityNode[]>([]);
  const [relationships, setRelationships] = useState<RelationshipEdge[]>([]);
  const [structureName, setStructureName] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [layoutMode, setLayoutModeState] = useState<LayoutStrategy>("auto");
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isScenario, setIsScenario] = useState(false);
  const [scenarioLabel, setScenarioLabel] = useState<string | null>(null);
  const [parentStructureId, setParentStructureId] = useState<string | null>(null);
  const [parentStructureName, setParentStructureName] = useState<string | null>(null);

  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!structureId) return;

    async function load() {
      setLoading(true);

      const { data: struct } = await supabase
        .from("structures")
        .select("name, layout_mode, is_scenario, scenario_label, parent_structure_id")
        .eq("id", structureId)
        .single();
      setStructureName(struct?.name ?? "");
      setLayoutModeState((struct?.layout_mode as LayoutStrategy) ?? "auto");
      setIsScenario(!!(struct as any)?.is_scenario);
      setScenarioLabel((struct as any)?.scenario_label ?? null);
      const parentId = (struct as any)?.parent_structure_id ?? null;
      setParentStructureId(parentId);

      // Fetch parent name if scenario
      if (parentId) {
        const { data: parent } = await supabase
          .from("structures")
          .select("name")
          .eq("id", parentId)
          .single();
        setParentStructureName(parent?.name ?? null);
      } else {
        setParentStructureName(null);
      }

      const { data: seRows } = await supabase
        .from("structure_entities")
        .select("entity_id, position_x, position_y")
        .eq("structure_id", structureId);

      // Build positions map from DB
      const posMap = new Map<string, { x: number; y: number }>();
      const entityIds: string[] = [];
      for (const row of seRows ?? []) {
        entityIds.push(row.entity_id);
        if (row.position_x != null && row.position_y != null) {
          posMap.set(row.entity_id, { x: row.position_x, y: row.position_y });
        }
      }
      setNodePositions(posMap);

      if (entityIds.length === 0) {
        setEntities([]);
        setRelationships([]);
        setLoading(false);
        return;
      }

      const { data: entitiesData } = await supabase
        .from("entities")
        .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, is_trustee_company, is_investment_company, created_at")
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

  // ── Layout mode change (persisted to DB + audit) ─────────────────
  const setLayoutMode = useCallback(async (newMode: LayoutStrategy) => {
    if (!structureId) return;
    const prevMode = layoutMode;
    setLayoutModeState(newMode);

    await supabase
      .from("structures")
      .update({ layout_mode: newMode } as any)
      .eq("id", structureId);

    // Audit log for mode change
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, user_id")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .single();

    if (profile) {
      await supabase.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: profile.user_id,
        action: "layout_mode_change",
        entity_type: "structure",
        entity_id: structureId,
        after_state: { previous_mode: prevMode, new_mode: newMode } as any,
      });
    }
  }, [structureId, layoutMode]);

  // ── Save node positions to DB (debounced from graph) ─────────────
  const saveNodePositions = useCallback(async (positions: Map<string, { x: number; y: number }>) => {
    if (!structureId) return;
    setNodePositions(positions);

    // Batch upsert positions
    const updates = Array.from(positions.entries()).map(([entityId, pos]) => ({
      structure_id: structureId,
      entity_id: entityId,
      position_x: Math.round(pos.x * 100) / 100,
      position_y: Math.round(pos.y * 100) / 100,
    }));

    // Update each row individually (structure_entities has composite PK)
    for (const u of updates) {
      await supabase
        .from("structure_entities")
        .update({ position_x: u.position_x, position_y: u.position_y } as any)
        .eq("structure_id", u.structure_id)
        .eq("entity_id", u.entity_id);
    }
  }, [structureId]);

  // ── Clear all positions (reset to auto) ──────────────────────────
  const clearNodePositions = useCallback(async () => {
    if (!structureId) return;
    setNodePositions(new Map());

    await supabase
      .from("structure_entities")
      .update({ position_x: null, position_y: null } as any)
      .eq("structure_id", structureId);
  }, [structureId]);

  // ── Compute unified StructureHealth ─────────────────────────────

  const structureHealth = useMemo<StructureHealth>(() => {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const info: ValidationIssue[] = [];

    const entityMap = new Map(entities.map((e) => [e.id, e]));

    // --- A) Ownership % checks ---
    const byCompany = new Map<string, RelationshipEdge[]>();
    for (const rel of relationships) {
      if (rel.relationship_type !== "shareholder") continue;
      const arr = byCompany.get(rel.to_entity_id) ?? [];
      arr.push(rel);
      byCompany.set(rel.to_entity_id, arr);
    }

    for (const [companyId, rels] of byCompany) {
      const withPercent = rels.filter((r) => r.ownership_percent != null);
      const withoutPercent = rels.filter((r) => r.ownership_percent == null);
      const companyName = entityMap.get(companyId)?.name ?? companyId;

      if (withPercent.length === 0) {
        info.push({
          code: "ownership_no_percent",
          severity: "info",
          message: `"${companyName}" has shareholders but no ownership % recorded`,
          entity_id: companyId,
          entity_name: companyName,
        });
        continue;
      }

      const total = Math.round(withPercent.reduce((s, r) => s + (r.ownership_percent ?? 0), 0) * 100) / 100;

      if (withoutPercent.length > 0) {
        warnings.push({
          code: "ownership_incomplete",
          severity: "warning",
          message: `"${companyName}": ownership data incomplete — ${withoutPercent.length} shareholder(s) missing %`,
          entity_id: companyId,
          entity_name: companyName,
          details: { total, missing: withoutPercent.length },
        });
      } else if (total > 100) {
        errors.push({
          code: "ownership_exceeds",
          severity: "error",
          message: `"${companyName}": ownership totals ${total}% (exceeds 100%)`,
          entity_id: companyId,
          entity_name: companyName,
          details: { total },
        });
      } else if (total < 100) {
        warnings.push({
          code: "ownership_under",
          severity: "warning",
          message: `"${companyName}": ownership totals ${total}% (does not sum to 100%)`,
          entity_id: companyId,
          entity_name: companyName,
          details: { total },
        });
      }
    }

    // --- B) Required relationship checks ---
    const inboundTypes = new Map<string, Set<string>>();
    for (const rel of relationships) {
      const s = inboundTypes.get(rel.to_entity_id) ?? new Set();
      s.add(rel.relationship_type);
      inboundTypes.set(rel.to_entity_id, s);
    }

    for (const entity of entities) {
      const t = entity.entity_type;
      const inbound = inboundTypes.get(entity.id) ?? new Set();

      if ((t.startsWith("trust_") || t === "Trust") && !inbound.has("trustee")) {
        errors.push({
          code: "missing_trustee",
          severity: "error",
          message: `Trust "${entity.name}" has no trustee assigned`,
          entity_id: entity.id,
          entity_name: entity.name,
        });
      }

      if (t === "smsf" && !inbound.has("member")) {
        errors.push({
          code: "missing_member",
          severity: "error",
          message: `SMSF "${entity.name}" has no members assigned`,
          entity_id: entity.id,
          entity_name: entity.name,
        });
      }

      if (t === "Company" && !inbound.has("shareholder")) {
        // Only flag as warning; not error unless ownership data exists and is inconsistent
        const hasOwnershipData = byCompany.has(entity.id);
        if (!hasOwnershipData) {
          warnings.push({
            code: "missing_shareholder",
            severity: "warning",
            message: `Company "${entity.name}" has no shareholders`,
            entity_id: entity.id,
            entity_name: entity.name,
          });
        }
      }
    }

    // --- C) Circular ownership ---
    const adj = new Map<string, string[]>();
    for (const rel of relationships) {
      if (rel.relationship_type !== "shareholder") continue;
      const arr = adj.get(rel.from_entity_id) ?? [];
      arr.push(rel.to_entity_id);
      adj.set(rel.from_entity_id, arr);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];
    const reportedSets = new Set<string>();

    function dfs(node: string) {
      if (inStack.has(node)) {
        const cycleStart = stack.indexOf(node);
        const cycleIds = stack.slice(cycleStart);
        const key = [...cycleIds].sort().join(",");
        if (!reportedSets.has(key)) {
          reportedSets.add(key);
          const names = cycleIds.map((id) => entityMap.get(id)?.name ?? id);
          errors.push({
            code: "circular_ownership",
            severity: "error",
            message: `Circular ownership: ${names.join(" → ")} → ${names[0]}`,
            entity_id: cycleIds[0],
            entity_name: names[0],
            details: { cycle: cycleIds },
          });
        }
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      stack.push(node);
      for (const neighbor of adj.get(node) ?? []) dfs(neighbor);
      stack.pop();
      inStack.delete(node);
    }

    for (const nodeId of adj.keys()) {
      if (!visited.has(nodeId)) dfs(nodeId);
    }

    // --- D) Unclassified entities ---
    for (const entity of entities) {
      if (entity.entity_type === "Unclassified") {
        warnings.push({
          code: "unclassified",
          severity: "warning",
          message: `"${entity.name}" is unclassified — resolve via Review & Fix`,
          entity_id: entity.id,
          entity_name: entity.name,
        });
      }
    }

    // --- E) Duplicate name detection within structure ---
    const nameMap = new Map<string, EntityNode[]>();
    for (const entity of entities) {
      const norm = entity.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      const arr = nameMap.get(norm) ?? [];
      arr.push(entity);
      nameMap.set(norm, arr);
    }
    for (const [, dupes] of nameMap) {
      if (dupes.length < 2) continue;
      const sameType = dupes.every((d) => d.entity_type === dupes[0].entity_type);
      if (!sameType) continue;
      warnings.push({
        code: "duplicates_detected",
        severity: "warning",
        message: `${dupes.length} potential duplicates: "${dupes[0].name}"`,
        entity_id: dupes[0].id,
        entity_name: dupes[0].name,
        details: { entity_ids: dupes.map((d) => d.id) },
      });
    }

    // --- Score calculation (cap unclassified penalty at -30 total) ---
    const unclassifiedCount = warnings.filter((w) => w.code === "unclassified").length;
    const otherWarningCount = warnings.length - unclassifiedCount;
    const unclassifiedDeduction = Math.min(unclassifiedCount * 10, 30);
    const errorDeduction = errors.length * 25;
    const warningDeduction = otherWarningCount * 10 + unclassifiedDeduction;
    const infoDeduction = info.length * 2;
    const score = Math.max(0, 100 - errorDeduction - warningDeduction - infoDeduction);

    let status: StructureHealth["status"];
    if (errors.length > 0 || score < 60) {
      status = "critical";
    } else if (warnings.length > 0 || score < 85) {
      status = "warning";
    } else {
      status = "good";
    }

    if (errors.length || warnings.length) {
      console.log("[Structure Health]", { score, status, errors, warnings, info });
    }

    return { score, status, errors, warnings, info };
  }, [entities, relationships]);

  return { entities, relationships, structureName, loading, reload, structureHealth, layoutMode, nodePositions, setLayoutMode, saveNodePositions, clearNodePositions, isScenario, scenarioLabel, parentStructureId, parentStructureName };
}

// ── Hook: useFilteredGraph ─────────────────────────────────────────

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

    let filteredRels = relationships.filter((r) => {
      if (viewMode === "ownership" && !OWNERSHIP_VIEW_TYPES.has(r.relationship_type)) return false;
      if (viewMode === "control" && !CONTROL_VIEW_TYPES.has(r.relationship_type)) return false;
      if (!showFamily && FAMILY_TYPES.has(r.relationship_type)) return false;
      if (filterRelType && r.relationship_type !== filterRelType) return false;
      return true;
    });

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

// ── Standalone health computation for list page ────────────────────

export function computeStructureHealth(
  entities: EntityNode[],
  relationships: RelationshipEdge[]
): Pick<StructureHealth, "score" | "status"> {
  let unclassifiedCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Ownership checks
  const byCompany = new Map<string, RelationshipEdge[]>();
  for (const rel of relationships) {
    if (rel.relationship_type !== "shareholder") continue;
    const arr = byCompany.get(rel.to_entity_id) ?? [];
    arr.push(rel);
    byCompany.set(rel.to_entity_id, arr);
  }
  for (const [, rels] of byCompany) {
    const withPercent = rels.filter((r) => r.ownership_percent != null);
    const withoutPercent = rels.filter((r) => r.ownership_percent == null);
    if (withPercent.length === 0) { infoCount++; continue; }
    const total = Math.round(withPercent.reduce((s, r) => s + (r.ownership_percent ?? 0), 0) * 100) / 100;
    if (withoutPercent.length > 0) warningCount++;
    else if (total > 100) errorCount++;
    else if (total < 100) warningCount++;
  }

  // Required relationships
  const inboundTypes = new Map<string, Set<string>>();
  for (const rel of relationships) {
    const s = inboundTypes.get(rel.to_entity_id) ?? new Set();
    s.add(rel.relationship_type);
    inboundTypes.set(rel.to_entity_id, s);
  }
  for (const entity of entities) {
    const t = entity.entity_type;
    const inbound = inboundTypes.get(entity.id) ?? new Set();
    if ((t.startsWith("trust_") || t === "Trust") && !inbound.has("trustee")) errorCount++;
    if (t === "smsf" && !inbound.has("member")) errorCount++;
    if (t === "Company" && !inbound.has("shareholder")) {
      const hasOwnershipData = byCompany.has(entity.id);
      if (!hasOwnershipData) warningCount++;
    }
    if (t === "Unclassified") unclassifiedCount++;
  }

  // Circular ownership (quick DFS)
  const adj = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.relationship_type !== "shareholder") continue;
    const arr = adj.get(rel.from_entity_id) ?? [];
    arr.push(rel.to_entity_id);
    adj.set(rel.from_entity_id, arr);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();
  let hasCycle = false;
  function dfs(node: string) {
    if (hasCycle) return;
    if (inStack.has(node)) { hasCycle = true; return; }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    for (const n of adj.get(node) ?? []) dfs(n);
    inStack.delete(node);
  }
  for (const nodeId of adj.keys()) { if (!visited.has(nodeId)) dfs(nodeId); }
  if (hasCycle) errorCount++;

  const unclassifiedDeduction = Math.min(unclassifiedCount * 10, 30);
  const score = Math.max(0, 100 - errorCount * 25 - warningCount * 10 - unclassifiedDeduction - infoCount * 2);
  let status: StructureHealth["status"];
  if (errorCount > 0 || score < 60) status = "critical";
  else if ((warningCount + unclassifiedCount) > 0 || score < 85) status = "warning";
  else status = "good";

  return { score, status };
}
