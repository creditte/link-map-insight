/**
 * Deterministic Structure Health Scoring Engine v2
 *
 * Score scale: 0–100, displayed as /10 with one decimal.
 *
 * Categories:
 *   A) Control Integrity   — 40 points
 *   B) Governance Completeness — 30 points
 *   C) Structural Clarity  — 20 points
 *   D) Data Completeness   — 10 points
 *
 * Corporate trustee rule: if any trust lacks a corporate trustee,
 * the score is capped at 90 (9.0/10).
 */

import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { isDirectionValid, getDirectionError, getRelationshipLabel } from "@/lib/relationshipRules";

// ── Types ──────────────────────────────────────────────────────────

export interface ScoringIssue {
  code: string;
  category: "control" | "governance" | "structural" | "data";
  severity: "critical" | "gap" | "minor" | "info";
  message: string;
  entity_id?: string;
  entity_name?: string;
  relationship_id?: string;
  deduction: number;
  details?: any;
}

export interface HealthScoreV2 {
  rawScore: number;        // 0–100 before cap
  score: number;           // 0–100 after cap
  displayScore: number;    // 0.0–10.0 (one decimal)
  label: string;
  isCapped: boolean;       // true if corporate trustee cap applied
  capReason?: string;

  controlScore: number;    // 0–40
  governanceScore: number; // 0–30
  structuralScore: number; // 0–20
  dataScore: number;       // 0–10

  issues: ScoringIssue[];
  criticalGaps: ScoringIssue[];
  governanceGaps: ScoringIssue[];
  diagramIntegrity: ScoringIssue[];
  dataGaps: ScoringIssue[];

  // Snapshot summary fields
  entityCount: number;
  depthEstimate: number;
  controlChainStatus: "Confirmed" | "Incomplete";
  dataGapCount: number;
  oneLiner: string;
}

// ── Trust-like type helpers ───────────────────────────────────────

const TRUST_TYPES = new Set([
  "Trust", "trust_discretionary", "trust_unit", "trust_hybrid",
  "trust_bare", "trust_testamentary", "trust_deceased_estate",
  "trust_family", "smsf",
]);

function isTrustType(t: string): boolean {
  return TRUST_TYPES.has(t);
}

function isSMSF(t: string): boolean {
  return t === "smsf";
}

function isCompany(t: string): boolean {
  return t === "Company";
}

// ── Labels ────────────────────────────────────────────────────────

export function getHealthLabel(score: number): string {
  if (score >= 100) return "Structure Complete";
  if (score >= 70) return "Minor Gaps";
  if (score >= 50) return "Control Incomplete";
  if (score >= 30) return "Governance Gaps";
  return "Critical Issues";
}

export function getHealthStatus(score: number): "good" | "warning" | "critical" {
  if (score >= 90) return "good";
  if (score >= 50) return "warning";
  return "critical";
}

// ── Depth estimation ──────────────────────────────────────────────

function estimateDepth(
  entities: EntityNode[],
  relationships: RelationshipEdge[]
): number {
  if (entities.length === 0) return 0;
  const ownershipTypes = new Set(["shareholder", "beneficiary", "trustee", "member"]);
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const rel of relationships) {
    if (!ownershipTypes.has(rel.relationship_type)) continue;
    // to_entity_id is the "parent" (the entity being owned/managed)
    const arr = children.get(rel.to_entity_id) ?? [];
    arr.push(rel.from_entity_id);
    children.set(rel.to_entity_id, arr);
    hasParent.add(rel.from_entity_id);
  }

  // Roots = entities with no parent
  const entityIds = new Set(entities.map((e) => e.id));
  const roots = entities.filter((e) => !hasParent.has(e.id)).map((e) => e.id);
  if (roots.length === 0) return 1;

  let maxDepth = 0;
  const visited = new Set<string>();

  function dfs(node: string, depth: number) {
    if (visited.has(node)) return;
    visited.add(node);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of children.get(node) ?? []) {
      if (entityIds.has(child)) dfs(child, depth + 1);
    }
    visited.delete(node);
  }

  for (const root of roots) dfs(root, 1);
  return maxDepth || 1;
}

// ── Main scoring function ─────────────────────────────────────────

export function computeHealthScoreV2(
  entities: EntityNode[],
  relationships: RelationshipEdge[]
): HealthScoreV2 {
  const issues: ScoringIssue[] = [];
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Build relationship lookups
  const inboundByType = new Map<string, Map<string, RelationshipEdge[]>>();
  const outboundByType = new Map<string, Map<string, RelationshipEdge[]>>();
  const allRelated = new Set<string>();

  for (const rel of relationships) {
    allRelated.add(rel.from_entity_id);
    allRelated.add(rel.to_entity_id);

    // Inbound: keyed by to_entity_id → relationship_type → rels
    if (!inboundByType.has(rel.to_entity_id)) inboundByType.set(rel.to_entity_id, new Map());
    const inMap = inboundByType.get(rel.to_entity_id)!;
    if (!inMap.has(rel.relationship_type)) inMap.set(rel.relationship_type, []);
    inMap.get(rel.relationship_type)!.push(rel);

    // Outbound
    if (!outboundByType.has(rel.from_entity_id)) outboundByType.set(rel.from_entity_id, new Map());
    const outMap = outboundByType.get(rel.from_entity_id)!;
    if (!outMap.has(rel.relationship_type)) outMap.set(rel.relationship_type, []);
    outMap.get(rel.relationship_type)!.push(rel);
  }

  // ─── A) Control Integrity (40 points) ──────────────────────────

  let controlDeductions = 0;

  // Missing trustee for trusts
  for (const entity of entities) {
    if (!isTrustType(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const trustees = inbound?.get("trustee") ?? [];
    if (trustees.length === 0) {
      const ded = 15;
      controlDeductions += ded;
      issues.push({
        code: "missing_trustee",
        category: "control",
        severity: "critical",
        message: `Trust "${entity.name}" has no trustee assigned`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  // Missing appointer for trusts (if model supports it)
  for (const entity of entities) {
    if (!isTrustType(entity.entity_type) || isSMSF(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const appointers = inbound?.get("appointer") ?? [];
    if (appointers.length === 0) {
      const ded = 15;
      controlDeductions += ded;
      issues.push({
        code: "missing_appointer",
        category: "control",
        severity: "critical",
        message: `Trust "${entity.name}" has no appointor recorded`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  // Missing member for SMSF
  for (const entity of entities) {
    if (!isSMSF(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const members = inbound?.get("member") ?? [];
    if (members.length === 0) {
      const ded = 15;
      controlDeductions += ded;
      issues.push({
        code: "missing_member",
        category: "control",
        severity: "critical",
        message: `SMSF "${entity.name}" has no members assigned`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  // Ownership chain broken (can't trace upward)
  // Check if there are entities with ownership rels that don't connect back to an individual
  const shareholderAdj = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.relationship_type !== "shareholder") continue;
    const arr = shareholderAdj.get(rel.from_entity_id) ?? [];
    arr.push(rel.to_entity_id);
    shareholderAdj.set(rel.from_entity_id, arr);
  }

  // Circular ownership detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  let hasCycle = false;
  const cycleEntities: string[] = [];

  function dfs(node: string) {
    if (hasCycle) return;
    if (inStack.has(node)) {
      hasCycle = true;
      const cycleStart = stack.indexOf(node);
      cycleEntities.push(...stack.slice(cycleStart));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    stack.push(node);
    for (const neighbor of shareholderAdj.get(node) ?? []) dfs(neighbor);
    stack.pop();
    inStack.delete(node);
  }
  for (const nodeId of shareholderAdj.keys()) {
    if (!visited.has(nodeId)) dfs(nodeId);
  }

  if (hasCycle) {
    const ded = 20;
    controlDeductions += ded;
    const names = cycleEntities.map((id) => entityMap.get(id)?.name ?? id);
    issues.push({
      code: "circular_ownership",
      category: "control",
      severity: "critical",
      message: `Circular ownership detected: ${names.join(" → ")} → ${names[0]}`,
      entity_id: cycleEntities[0],
      entity_name: names[0],
      deduction: ded,
      details: { cycle: cycleEntities },
    });
  }

  const controlScore = Math.max(0, 40 - controlDeductions);

  // ─── B) Governance Completeness (30 points) ────────────────────

  let governanceDeductions = 0;

  // Missing directors for companies
  for (const entity of entities) {
    if (!isCompany(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const directors = inbound?.get("director") ?? [];
    if (directors.length === 0) {
      const ded = 5;
      governanceDeductions += ded;
      issues.push({
        code: "missing_directors",
        category: "governance",
        severity: "gap",
        message: `Company "${entity.name}" has no directors recorded`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  // Missing ownership percentages where ownership relationships exist
  for (const rel of relationships) {
    if (rel.relationship_type !== "shareholder") continue;
    if (rel.ownership_percent == null) {
      const from = entityMap.get(rel.from_entity_id);
      const to = entityMap.get(rel.to_entity_id);
      const ded = 5;
      governanceDeductions += ded;
      issues.push({
        code: "missing_ownership_percent",
        category: "governance",
        severity: "gap",
        message: `Ownership % not recorded: ${from?.name ?? "?"} → ${to?.name ?? "?"}`,
        entity_id: rel.to_entity_id,
        entity_name: to?.name,
        relationship_id: rel.id,
        deduction: ded,
      });
    }
  }

  // Ownership % exceeds 100
  const byCompany = new Map<string, RelationshipEdge[]>();
  for (const rel of relationships) {
    if (rel.relationship_type !== "shareholder") continue;
    const arr = byCompany.get(rel.to_entity_id) ?? [];
    arr.push(rel);
    byCompany.set(rel.to_entity_id, arr);
  }
  for (const [companyId, rels] of byCompany) {
    const withPercent = rels.filter((r) => r.ownership_percent != null);
    if (withPercent.length === 0) continue;
    const total = Math.round(withPercent.reduce((s, r) => s + (r.ownership_percent ?? 0), 0) * 100) / 100;
    const companyName = entityMap.get(companyId)?.name ?? companyId;
    if (total > 100) {
      const ded = 5;
      governanceDeductions += ded;
      issues.push({
        code: "ownership_exceeds",
        category: "governance",
        severity: "gap",
        message: `"${companyName}": ownership totals ${total}% (exceeds 100%)`,
        entity_id: companyId,
        entity_name: companyName,
        deduction: ded,
        details: { total },
      });
    }
  }

  // Missing shareholders for companies
  for (const entity of entities) {
    if (!isCompany(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const shareholders = inbound?.get("shareholder") ?? [];
    if (shareholders.length === 0) {
      const ded = 5;
      governanceDeductions += ded;
      issues.push({
        code: "missing_shareholders",
        category: "governance",
        severity: "gap",
        message: `Company "${entity.name}" has no shareholders recorded`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  const governanceScore = Math.max(0, 30 - governanceDeductions);

  // ─── C) Structural Clarity (20 points) ──────────────────────────

  let structuralDeductions = 0;

  // Orphan entities (no relationships at all)
  for (const entity of entities) {
    if (!allRelated.has(entity.id)) {
      const ded = 5;
      structuralDeductions += ded;
      issues.push({
        code: "orphan_entity",
        category: "structural",
        severity: "minor",
        message: `"${entity.name}" has no relationships — orphan entity`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  // Duplicate / conflicting relationships
  const relSignatures = new Map<string, RelationshipEdge[]>();
  for (const rel of relationships) {
    const sig = `${rel.from_entity_id}:${rel.relationship_type}:${rel.to_entity_id}`;
    const arr = relSignatures.get(sig) ?? [];
    arr.push(rel);
    relSignatures.set(sig, arr);
  }
  for (const [, rels] of relSignatures) {
    if (rels.length < 2) continue;
    const from = entityMap.get(rels[0].from_entity_id);
    const to = entityMap.get(rels[0].to_entity_id);
    const ded = 5;
    structuralDeductions += ded;
    issues.push({
      code: "duplicate_relationship",
      category: "structural",
      severity: "minor",
      message: `Duplicate ${rels[0].relationship_type} relationship: ${from?.name ?? "?"} → ${to?.name ?? "?"}`,
      entity_id: rels[0].from_entity_id,
      entity_name: from?.name,
      deduction: ded,
    });
  }

  // Invalid relationships (any type violating the central rules engine)
  for (const rel of relationships) {
    const from = entityMap.get(rel.from_entity_id);
    const to = entityMap.get(rel.to_entity_id);
    if (from && to && !isDirectionValid(rel.relationship_type, from.entity_type, to.entity_type)) {
      const ded = 5;
      structuralDeductions += ded;
      const errorMsg = getDirectionError(rel.relationship_type, from.entity_type, to.entity_type);
      issues.push({
        code: "invalid_relationship_direction",
        category: "structural",
        severity: "critical",
        message: `Invalid ${getRelationshipLabel(rel.relationship_type)} relationship: "${from.name}" (${from.entity_type}) → "${to.name}" (${to.entity_type}). ${errorMsg ?? ""}`,
        entity_id: from.id,
        entity_name: from.name,
        relationship_id: rel.id,
        deduction: ded,
      });
    }
  }


  for (const entity of entities) {
    if (entity.entity_type === "Unclassified") {
      const ded = 3;
      structuralDeductions += ded;
      issues.push({
        code: "unclassified",
        category: "structural",
        severity: "minor",
        message: `"${entity.name}" is unclassified — resolve via Review & Fix`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  const structuralScore = Math.max(0, 20 - structuralDeductions);

  // ─── D) Data Completeness (10 points) ───────────────────────────

  let dataDeductions = 0;

  // Missing entity type (already covered by unclassified above, but for explicit check)
  // Missing name is impossible (required field)
  // Check for missing identifiers where relevant (ABN/ACN for companies)
  for (const entity of entities) {
    if (isCompany(entity.entity_type) && !entity.acn && !entity.abn) {
      const ded = 2;
      dataDeductions += ded;
      issues.push({
        code: "missing_identifiers",
        category: "data",
        severity: "info",
        message: `"${entity.name}" has no ABN or ACN recorded`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: ded,
      });
    }
  }

  const dataScore = Math.max(0, 10 - dataDeductions);

  // ─── Total Score ────────────────────────────────────────────────

  let rawScore = controlScore + governanceScore + structuralScore + dataScore;
  rawScore = Math.max(0, Math.min(100, rawScore));

  // ─── Corporate Trustee Cap ──────────────────────────────────────

  let isCapped = false;
  let capReason: string | undefined;

  // Check if every trust has a corporate trustee
  for (const entity of entities) {
    if (!isTrustType(entity.entity_type)) continue;
    const inbound = inboundByType.get(entity.id);
    const trustees = inbound?.get("trustee") ?? [];
    const hasCorporateTrustee = trustees.some((rel) => {
      const trusteeEntity = entityMap.get(rel.from_entity_id);
      return trusteeEntity && isCompany(trusteeEntity.entity_type);
    });

    if (!hasCorporateTrustee && trustees.length > 0) {
      // Has trustee but not corporate
      isCapped = true;
      capReason = "One or more trusts do not have a corporate trustee recorded. Corporate trustees are required for a full score.";
      issues.push({
        code: "no_corporate_trustee",
        category: "governance",
        severity: "gap",
        message: `Trust "${entity.name}" does not have a corporate trustee recorded`,
        entity_id: entity.id,
        entity_name: entity.name,
        deduction: 0, // Already factored via cap
      });
    }
  }

  const score = isCapped ? Math.min(rawScore, 90) : rawScore;
  const displayScore = score; // same as score, kept for compatibility

  // ─── Categorize issues ──────────────────────────────────────────

  const criticalGaps = issues.filter((i) => i.severity === "critical");
  const governanceGaps = issues.filter((i) => i.category === "governance");
  const diagramIntegrity = issues.filter((i) => i.category === "structural");
  const dataGapsList = issues.filter((i) => i.category === "data");

  // ─── Snapshot summary ──────────────────────────────────────────

  const entityCount = entities.length;
  const depthEstimate = estimateDepth(entities, relationships);
  const controlChainStatus: "Confirmed" | "Incomplete" =
    controlScore === 40 ? "Confirmed" : "Incomplete";
  const dataGapCount = issues.length;

  // One-liner
  let oneLiner: string;
  if (score === 100) {
    oneLiner = "Structure is complete with all governance and control relationships recorded.";
  } else if (score >= 70) {
    oneLiner = "Diagram is structurally logical but has minor gaps in recorded governance or control relationships.";
  } else if (score >= 50) {
    oneLiner = "Diagram is structurally logical but missing key control relationships required to confirm governance clarity.";
  } else if (score >= 30) {
    oneLiner = "Significant governance gaps exist that must be addressed before the structure can be considered complete.";
  } else {
    oneLiner = "Critical structural and governance issues require immediate attention.";
  }

  return {
    rawScore,
    score,
    displayScore,
    label: getHealthLabel(score),
    isCapped,
    capReason,
    controlScore,
    governanceScore,
    structuralScore,
    dataScore,
    issues,
    criticalGaps,
    governanceGaps,
    diagramIntegrity,
    dataGapsList: dataGapsList as any,
    dataGaps: dataGapsList,
    entityCount,
    depthEstimate,
    controlChainStatus,
    dataGapCount,
    oneLiner,
  } as HealthScoreV2;
}

// ─── Lightweight version for list page ────────────────────────────

export function computeHealthScoreV2Light(
  entities: EntityNode[],
  relationships: RelationshipEdge[]
): { score: number; displayScore: number; label: string; status: "good" | "warning" | "critical" } {
  const full = computeHealthScoreV2(entities, relationships);
  return {
    score: full.score,
    displayScore: full.score,
    label: full.label,
    status: getHealthStatus(full.score),
  };
}
