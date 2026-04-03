/**
 * Shared hook for computing workspace-level structure health.
 * Used by both ClientGovernance (Health Check) and Review & Improve pages
 * to ensure consistent data across the app.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeHealthScoreV2, getHealthStatus } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import type { ScoringIssue } from "@/lib/structureScoring";

/* ── Types ──────────────────────────────────────────────────────── */

export interface StructureResult {
  id: string;
  name: string;
  score: number;
  status: "good" | "warning" | "critical";
  friendlyLabel: string;
  issues: ScoringIssue[];
  criticalCount: number;
}

export interface CrossObservation {
  message: string;
  structureIds: string[];
}

export interface ClientReview {
  timestamp: string;
  clientScore: number;
  structures: StructureResult[];
  crossObservations: CrossObservation[];
  criticalStructures: number;
  needsAttention: number;
  /** Flat list of all issues across all structures, with structure context */
  allIssues: StructureIssue[];
}

export interface StructureIssue extends ScoringIssue {
  structure_id: string;
  structure_name: string;
}

/* ── Helpers ────────────────────────────────────────────────────── */

function getFriendlyLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Minor gaps";
  if (score >= 41) return "Needs attention";
  return "Critical";
}

/* ── Hook ───────────────────────────────────────────────────────── */

export function useClientHealthReview() {
  const [review, setReview] = useState<ClientReview | null>(null);
  const [loading, setLoading] = useState(false);

  const runReview = useCallback(async (): Promise<ClientReview | null> => {
    setLoading(true);
    try {
      const { data: structures } = await supabase
        .from("structures")
        .select("id, name")
        .is("deleted_at", null)
        .eq("is_scenario", false);

      if (!structures || structures.length === 0) {
        const empty: ClientReview = {
          timestamp: new Date().toISOString(),
          clientScore: 100,
          structures: [],
          crossObservations: [],
          criticalStructures: 0,
          needsAttention: 0,
          allIssues: [],
        };
        setReview(empty);
        setLoading(false);
        return empty;
      }

      const structureIds = structures.map((s) => s.id);

      const [seResult, srResult] = await Promise.all([
        supabase.from("structure_entities").select("structure_id, entity_id").in("structure_id", structureIds),
        supabase.from("structure_relationships").select("structure_id, relationship_id").in("structure_id", structureIds),
      ]);

      const seByStruct = new Map<string, string[]>();
      for (const row of seResult.data ?? []) {
        const arr = seByStruct.get(row.structure_id) ?? [];
        arr.push(row.entity_id);
        seByStruct.set(row.structure_id, arr);
      }

      const srByStruct = new Map<string, string[]>();
      for (const row of srResult.data ?? []) {
        const arr = srByStruct.get(row.structure_id) ?? [];
        arr.push(row.relationship_id);
        srByStruct.set(row.structure_id, arr);
      }

      const allEntityIds = new Set<string>();
      const allRelIds = new Set<string>();
      for (const ids of seByStruct.values()) ids.forEach((id) => allEntityIds.add(id));
      for (const ids of srByStruct.values()) ids.forEach((id) => allRelIds.add(id));

      const [entResult, relResult] = await Promise.all([
        allEntityIds.size > 0
          ? supabase.from("entities")
              .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, is_trustee_company, created_at")
              .in("id", Array.from(allEntityIds))
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),
        allRelIds.size > 0
          ? supabase.from("relationships")
              .select("id, from_entity_id, to_entity_id, relationship_type, source, ownership_percent, ownership_units, ownership_class, created_at")
              .in("id", Array.from(allRelIds))
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),
      ]);

      const entityById = new Map<string, EntityNode>();
      for (const e of (entResult.data ?? []) as any[]) entityById.set(e.id, e as EntityNode);

      const relById = new Map<string, RelationshipEdge>();
      for (const r of (relResult.data ?? []) as any[]) {
        relById.set(r.id, {
          id: r.id, from_entity_id: r.from_entity_id, to_entity_id: r.to_entity_id,
          relationship_type: r.relationship_type, source_data: r.source,
          ownership_percent: r.ownership_percent, ownership_units: r.ownership_units,
          ownership_class: r.ownership_class, created_at: r.created_at,
        });
      }

      const results: StructureResult[] = [];
      const allIssues: StructureIssue[] = [];
      let circularCount = 0;

      const trustsWithoutCorporateTrusteeIds: string[] = [];
      const missingAppointerIds: string[] = [];
      const circularIds: string[] = [];

      for (const s of structures) {
        const entIds = seByStruct.get(s.id) ?? [];
        const relIds = srByStruct.get(s.id) ?? [];
        const ents = entIds.map((id) => entityById.get(id)).filter(Boolean) as EntityNode[];
        const rels = relIds.map((id) => relById.get(id)).filter(Boolean) as RelationshipEdge[];
        const health = computeHealthScoreV2(ents, rels);

        results.push({
          id: s.id,
          name: s.name,
          score: health.score,
          status: getHealthStatus(health.score),
          friendlyLabel: getFriendlyLabel(health.score),
          issues: health.issues,
          criticalCount: health.criticalGaps.length,
        });

        // Flatten issues with structure context
        for (const issue of health.issues) {
          if (issue.severity === "info") continue; // skip info-level for review page
          allIssues.push({
            ...issue,
            structure_id: s.id,
            structure_name: s.name,
          });
        }

        if (health.isCapped) {
          trustsWithoutCorporateTrusteeIds.push(s.id);
        }
        const appointerIssues = health.issues.filter((i) => i.code === "missing_appointer");
        if (appointerIssues.length > 0) {
          missingAppointerIds.push(s.id);
        }
        if (health.issues.some((i) => i.code === "circular_ownership")) {
          circularCount++;
          circularIds.push(s.id);
        }
      }

      const crossObservations: CrossObservation[] = [];
      if (trustsWithoutCorporateTrusteeIds.length > 0)
        crossObservations.push({
          message: `${trustsWithoutCorporateTrusteeIds.length} structure${trustsWithoutCorporateTrusteeIds.length > 1 ? "s have" : " has"} trusts without corporate trustees`,
          structureIds: trustsWithoutCorporateTrusteeIds,
        });
      if (missingAppointerIds.length > 0) {
        const totalAppointerIssues = allIssues.filter((i) => i.code === "missing_appointer").length;
        crossObservations.push({
          message: `${totalAppointerIssues} trust${totalAppointerIssues > 1 ? "s" : ""} missing appointors across structures`,
          structureIds: missingAppointerIds,
        });
      }
      if (circularCount > 0)
        crossObservations.push({
          message: `${circularCount} structure${circularCount > 1 ? "s" : ""} with circular ownership detected`,
          structureIds: circularIds,
        });

      const avgScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        : 100;
      const allPerfect = results.every((r) => r.score >= 100);
      const finalClientScore = allPerfect ? avgScore : Math.min(avgScore, 99);

      const criticalStructures = results.filter((r) => r.status === "critical").length;
      const needsAttention = results.filter((r) => r.score < 100).length;

      // Sort issues: critical first, then by structure
      allIssues.sort((a, b) => {
        const severityOrder = { critical: 0, gap: 1, minor: 2, info: 3 };
        const sa = severityOrder[a.severity] ?? 3;
        const sb = severityOrder[b.severity] ?? 3;
        if (sa !== sb) return sa - sb;
        return a.structure_name.localeCompare(b.structure_name);
      });

      const result: ClientReview = {
        timestamp: new Date().toISOString(),
        clientScore: finalClientScore,
        structures: results.sort((a, b) => a.score - b.score),
        crossObservations,
        criticalStructures,
        needsAttention,
        allIssues,
      };

      setReview(result);
      setLoading(false);
      return result;
    } catch (e) {
      console.error("Review error:", e);
      setLoading(false);
      return null;
    }
  }, []);

  return { review, loading, runReview };
}
