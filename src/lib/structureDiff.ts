/**
 * Structure diff engine.
 * Compares two normalised datasets and returns added/removed/changed items.
 */

import { getEntityLabel } from "@/lib/entityTypes";

// ── Normalised types ──

export interface NormEntity {
  key: string; // stable identity key
  id: string;
  name: string;
  entity_type: string;
  abn: string | null;
  acn: string | null;
  is_operating_entity: boolean;
  is_trustee_company: boolean;
}

export interface NormRelationship {
  key: string; // from_key + type + to_key
  fromEntityKey: string;
  toEntityKey: string;
  fromName: string;
  toName: string;
  relationship_type: string;
  ownership_percent: number | null;
  ownership_units: number | null;
  ownership_class: string | null;
}

export interface EntityChange {
  entity: NormEntity;
  changes: { field: string; before: string; after: string }[];
}

export interface RelChange {
  rel: NormRelationship;
  changes: { field: string; before: string; after: string }[];
}

export interface DirectionChange {
  baseRel: NormRelationship;
  compareRel: NormRelationship;
}

export interface AmbiguousEntity {
  id: string;
  name: string;
  entity_type: string;
  side: "base" | "compare";
}

export interface DiffResult {
  entitiesAdded: NormEntity[];
  entitiesRemoved: NormEntity[];
  entitiesChanged: EntityChange[];
  relsAdded: NormRelationship[];
  relsRemoved: NormRelationship[];
  relsChanged: RelChange[];
  directionChanges: DirectionChange[];
  ambiguousCount: number;
  ambiguousEntities: AmbiguousEntity[];
}

// ── Identity key generation ──

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(pty|ltd|limited|proprietary|inc|incorporated|llc|trust|pty ltd|as trustee for)\s*/gi, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RawEntity {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid?: string | null;
  abn?: string | null;
  acn?: string | null;
  is_operating_entity?: boolean;
  is_trustee_company?: boolean;
}

export interface RawRelationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  ownership_percent?: number | null;
  ownership_units?: number | null;
  ownership_class?: string | null;
}

/**
 * Build a stable identity key for an entity.
 * Priority: xpm_uuid > (entity_type + normalised name) > id
 */
function entityKey(e: RawEntity, allEntities: RawEntity[]): { key: string; ambiguous: boolean } {
  if (e.xpm_uuid) return { key: `xpm:${e.xpm_uuid}`, ambiguous: false };

  const norm = normaliseName(e.name);
  const typeNameKey = `tn:${e.entity_type}:${norm}`;

  // Check for ambiguity: multiple entities with same type+normalised name
  const sameKeyCount = allEntities.filter(
    (o) => !o.xpm_uuid && o.entity_type === e.entity_type && normaliseName(o.name) === norm
  ).length;

  if (sameKeyCount > 1) {
    // Fallback to id-based key (only stable within same structure copy)
    return { key: `id:${e.id}`, ambiguous: true };
  }

  return { key: typeNameKey, ambiguous: false };
}

export function normaliseDataset(
  entities: RawEntity[],
  relationships: RawRelationship[],
  overrideKeys?: Map<string, string>
): { entities: Map<string, NormEntity>; relationships: Map<string, NormRelationship>; ambiguousCount: number; ambiguousIds: string[] } {
  let ambiguousCount = 0;
  const ambiguousIds: string[] = [];
  const entityKeyMap = new Map<string, string>();
  const normEntities = new Map<string, NormEntity>();

  for (const e of entities) {
    const override = overrideKeys?.get(e.id);
    let key: string;
    if (override) {
      key = override;
    } else {
      const result = entityKey(e, entities);
      key = result.key;
      if (result.ambiguous) { ambiguousCount++; ambiguousIds.push(e.id); }
    }
    entityKeyMap.set(e.id, key);
    normEntities.set(key, {
      key,
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      abn: e.abn ?? null,
      acn: e.acn ?? null,
      is_operating_entity: e.is_operating_entity ?? false,
      is_trustee_company: e.is_trustee_company ?? false,
    });
  }

  const normRels = new Map<string, NormRelationship>();
  for (const r of relationships) {
    const fromKey = entityKeyMap.get(r.from_entity_id);
    const toKey = entityKeyMap.get(r.to_entity_id);
    if (!fromKey || !toKey) continue;

    const relKey = `${fromKey}|${r.relationship_type}|${toKey}`;
    const fromEnt = normEntities.get(fromKey);
    const toEnt = normEntities.get(toKey);

    normRels.set(relKey, {
      key: relKey,
      fromEntityKey: fromKey,
      toEntityKey: toKey,
      fromName: fromEnt?.name ?? r.from_entity_id,
      toName: toEnt?.name ?? r.to_entity_id,
      relationship_type: r.relationship_type,
      ownership_percent: r.ownership_percent ?? null,
      ownership_units: r.ownership_units ?? null,
      ownership_class: r.ownership_class ?? null,
    });
  }

  return { entities: normEntities, relationships: normRels, ambiguousCount, ambiguousIds };
}

// ── Diff computation ──

function str(v: any): string {
  if (v == null) return "";
  return String(v);
}

export function computeDiff(
  base: { entities: Map<string, NormEntity>; relationships: Map<string, NormRelationship>; ambiguousCount: number; ambiguousIds: string[] },
  compare: { entities: Map<string, NormEntity>; relationships: Map<string, NormRelationship>; ambiguousCount: number; ambiguousIds: string[] },
  baseRawEntities?: RawEntity[],
  compareRawEntities?: RawEntity[]
): DiffResult {
  // Entities
  const entitiesAdded: NormEntity[] = [];
  const entitiesRemoved: NormEntity[] = [];
  const entitiesChanged: EntityChange[] = [];

  for (const [key, ce] of compare.entities) {
    if (!base.entities.has(key)) {
      entitiesAdded.push(ce);
    }
  }

  for (const [key, be] of base.entities) {
    if (!compare.entities.has(key)) {
      entitiesRemoved.push(be);
    } else {
      const ce = compare.entities.get(key)!;
      const changes: { field: string; before: string; after: string }[] = [];
      if (be.name !== ce.name) changes.push({ field: "Name", before: be.name, after: ce.name });
      if (be.entity_type !== ce.entity_type) changes.push({ field: "Type", before: getEntityLabel(be.entity_type), after: getEntityLabel(ce.entity_type) });
      if (str(be.abn) !== str(ce.abn)) changes.push({ field: "ABN", before: be.abn ?? "–", after: ce.abn ?? "–" });
      if (str(be.acn) !== str(ce.acn)) changes.push({ field: "ACN", before: be.acn ?? "–", after: ce.acn ?? "–" });
      if (be.is_operating_entity !== ce.is_operating_entity) changes.push({ field: "Operating Entity", before: be.is_operating_entity ? "Yes" : "No", after: ce.is_operating_entity ? "Yes" : "No" });
      if (be.is_trustee_company !== ce.is_trustee_company) changes.push({ field: "Trustee Company", before: be.is_trustee_company ? "Yes" : "No", after: ce.is_trustee_company ? "Yes" : "No" });
      if (changes.length > 0) entitiesChanged.push({ entity: ce, changes });
    }
  }

  // Relationships
  const relsAdded: NormRelationship[] = [];
  const relsRemoved: NormRelationship[] = [];
  const relsChanged: RelChange[] = [];
  const directionChanges: DirectionChange[] = [];
  const processedReversals = new Set<string>();

  for (const [key, cr] of compare.relationships) {
    if (!base.relationships.has(key)) {
      relsAdded.push(cr);
    }
  }

  for (const [key, br] of base.relationships) {
    if (!compare.relationships.has(key)) {
      relsRemoved.push(br);
    } else {
      const cr = compare.relationships.get(key)!;
      const changes: { field: string; before: string; after: string }[] = [];
      if (str(br.ownership_percent) !== str(cr.ownership_percent)) {
        changes.push({ field: "Ownership %", before: br.ownership_percent != null ? `${br.ownership_percent}%` : "–", after: cr.ownership_percent != null ? `${cr.ownership_percent}%` : "–" });
      }
      if (str(br.ownership_units) !== str(cr.ownership_units)) {
        changes.push({ field: "Units", before: str(br.ownership_units) || "–", after: str(cr.ownership_units) || "–" });
      }
      if (str(br.ownership_class) !== str(cr.ownership_class)) {
        changes.push({ field: "Class", before: br.ownership_class ?? "–", after: cr.ownership_class ?? "–" });
      }
      if (changes.length > 0) relsChanged.push({ rel: cr, changes });
    }
  }

  // Direction changes: find removed rels that exist reversed in added
  for (const removed of relsRemoved) {
    const reversedKey = `${removed.toEntityKey}|${removed.relationship_type}|${removed.fromEntityKey}`;
    const addedMatch = relsAdded.find((a) => a.key === reversedKey);
    if (addedMatch && !processedReversals.has(removed.key)) {
      directionChanges.push({ baseRel: removed, compareRel: addedMatch });
      processedReversals.add(removed.key);
      processedReversals.add(addedMatch.key);
    }
  }

  // Remove direction changes from added/removed
  const finalAdded = relsAdded.filter((a) => !processedReversals.has(a.key));
  const finalRemoved = relsRemoved.filter((r) => !processedReversals.has(r.key));

  // Build ambiguous entities list
  const ambiguousEntities: AmbiguousEntity[] = [];
  if (baseRawEntities) {
    for (const id of base.ambiguousIds) {
      const e = baseRawEntities.find((r) => r.id === id);
      if (e) ambiguousEntities.push({ id: e.id, name: e.name, entity_type: e.entity_type, side: "base" });
    }
  }
  if (compareRawEntities) {
    for (const id of compare.ambiguousIds) {
      const e = compareRawEntities.find((r) => r.id === id);
      if (e) ambiguousEntities.push({ id: e.id, name: e.name, entity_type: e.entity_type, side: "compare" });
    }
  }

  return {
    entitiesAdded,
    entitiesRemoved,
    entitiesChanged,
    relsAdded: finalAdded,
    relsRemoved: finalRemoved,
    relsChanged,
    directionChanges,
    ambiguousCount: base.ambiguousCount + compare.ambiguousCount,
    ambiguousEntities,
  };
}

// ── Relationship categories for filtering ──

const OWNERSHIP_TYPES = new Set(["shareholder", "beneficiary", "partner", "member"]);
const CONTROL_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

export type DiffFilter = "all" | "ownership" | "control";

export function filterDiffRels<T extends { relationship_type: string }>(items: T[], filter: DiffFilter): T[] {
  if (filter === "all") return items;
  const types = filter === "ownership" ? OWNERSHIP_TYPES : CONTROL_TYPES;
  return items.filter((i) => types.has(i.relationship_type));
}
