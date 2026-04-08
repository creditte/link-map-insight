/**
 * Central Relationship Rules Engine
 *
 * This is the SINGLE SOURCE OF TRUTH for all relationship type validation
 * across the entire application. Every component, form, import, sync,
 * scoring engine, and database trigger should derive its logic from
 * the RELATIONSHIP_RULES config defined here.
 *
 * Entity type mapping:
 *   The DB stores entity_type values like "Individual", "Company",
 *   "trust_discretionary", "smsf", etc. This module works with those
 *   raw DB values via a normalisation layer so the rules can use
 *   simplified canonical names.
 */

// ── Canonical entity categories ──────────────────────────────────

/** All trust-like DB entity_type values (excluding smsf) */
const DISCRETIONARY_TRUST_TYPES = new Set([
  "Trust",               // legacy
  "trust_discretionary",
  "trust_family",
]);

const UNIT_TRUST_TYPES = new Set(["trust_unit"]);
const HYBRID_TRUST_TYPES = new Set(["trust_hybrid"]);
const OTHER_TRUST_TYPES = new Set([
  "trust_bare",
  "trust_testamentary",
  "trust_deceased_estate",
]);

/** All trust DB types (including smsf) */
const ALL_TRUST_DB_TYPES = new Set([
  ...DISCRETIONARY_TRUST_TYPES,
  ...UNIT_TRUST_TYPES,
  ...HYBRID_TRUST_TYPES,
  ...OTHER_TRUST_TYPES,
  "smsf",
]);

/** Canonical categories used in rules */
export type CanonicalEntityCategory =
  | "individual"
  | "company"
  | "discretionary_trust"
  | "unit_trust"
  | "hybrid_trust"
  | "other_trust"
  | "smsf";

/** Map a raw DB entity_type to canonical categories (one type can match multiple) */
export function getCanonicalCategories(dbEntityType: string): CanonicalEntityCategory[] {
  if (dbEntityType === "Individual") return ["individual"];
  if (dbEntityType === "Company") return ["company"];
  if (dbEntityType === "smsf") return ["smsf"];
  if (DISCRETIONARY_TRUST_TYPES.has(dbEntityType)) return ["discretionary_trust"];
  if (UNIT_TRUST_TYPES.has(dbEntityType)) return ["unit_trust"];
  if (HYBRID_TRUST_TYPES.has(dbEntityType)) return ["hybrid_trust"];
  if (OTHER_TRUST_TYPES.has(dbEntityType)) return ["other_trust"];
  // Partnership, Sole Trader, Incorporated Association, Unclassified — no canonical category
  return [];
}

function matchesCategories(
  dbEntityType: string,
  allowedCategories: readonly CanonicalEntityCategory[],
): boolean {
  const cats = getCanonicalCategories(dbEntityType);
  return cats.some((c) => allowedCategories.includes(c));
}

// ── Relationship rule definition ─────────────────────────────────

export type RelationshipCategory = "governance" | "ownership";

export interface RelationshipRule {
  /** The value stored in DB relationship_type column */
  type: string;
  /** Human-readable label for UI */
  label: string;
  /** Canonical entity categories allowed as source (from) */
  allowedSourceTypes: readonly CanonicalEntityCategory[];
  /** Canonical entity categories allowed as target (to) */
  allowedTargetTypes: readonly CanonicalEntityCategory[];
  /** Whether the reverse direction is allowed (always false for now) */
  allowReverse: boolean;
  /** Validation error message shown when rule is violated */
  validationMessage: string;
  /** Functional grouping */
  category: RelationshipCategory;
  /** Which optional metadata fields are relevant */
  metadataFields: readonly MetadataField[];
}

export type MetadataField = "ownership_percent" | "ownership_units" | "ownership_class";

// ── The central rules configuration ──────────────────────────────

export const RELATIONSHIP_RULES: readonly RelationshipRule[] = [
  {
    type: "director",
    label: "Director",
    allowedSourceTypes: ["individual"],
    allowedTargetTypes: ["company"],
    allowReverse: false,
    validationMessage: "Directors must be individuals and can only be linked to companies.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "shareholder",
    label: "Shareholder",
    allowedSourceTypes: ["individual", "company", "discretionary_trust", "unit_trust", "smsf"],
    allowedTargetTypes: ["company"],
    allowReverse: false,
    validationMessage: "Shareholders can only be linked to companies.",
    category: "ownership",
    metadataFields: ["ownership_percent", "ownership_units", "ownership_class"],
  },
  {
    type: "trustee",
    label: "Trustee",
    allowedSourceTypes: ["individual", "company"],
    allowedTargetTypes: ["discretionary_trust", "unit_trust", "hybrid_trust", "other_trust", "smsf"],
    allowReverse: false,
    validationMessage: "Trustees must be individuals or companies and can only be linked to trusts or SMSFs.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "beneficiary",
    label: "Beneficiary",
    allowedSourceTypes: ["individual", "company", "discretionary_trust", "smsf"],
    allowedTargetTypes: ["discretionary_trust", "hybrid_trust", "other_trust"],
    allowReverse: false,
    validationMessage: "Beneficiaries can only be linked to eligible trust entities.",
    category: "ownership",
    metadataFields: ["ownership_percent"],
  },
  {
    type: "member",
    label: "Member",
    allowedSourceTypes: ["individual", "company", "discretionary_trust", "smsf"],
    allowedTargetTypes: ["unit_trust", "smsf"],
    allowReverse: false,
    validationMessage: "Members can only be linked to unit trusts or SMSFs.",
    category: "ownership",
    metadataFields: ["ownership_percent", "ownership_units"],
  },
  {
    type: "appointer",
    label: "Appointor",
    allowedSourceTypes: ["individual", "company"],
    allowedTargetTypes: ["discretionary_trust", "unit_trust", "hybrid_trust", "other_trust"],
    allowReverse: false,
    validationMessage: "Appointors must be individuals or companies and can only be linked to trusts.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "settlor",
    label: "Settlor",
    allowedSourceTypes: ["individual", "company"],
    allowedTargetTypes: ["discretionary_trust", "unit_trust", "hybrid_trust", "other_trust"],
    allowReverse: false,
    validationMessage: "Settlors can only be linked to trust entities.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "partner",
    label: "Partner",
    allowedSourceTypes: ["individual", "company"],
    allowedTargetTypes: ["individual", "company"], // Partnerships are entity-to-entity
    allowReverse: true,
    validationMessage: "Partners must be individuals or companies.",
    category: "ownership",
    metadataFields: ["ownership_percent"],
  },
  {
    type: "spouse",
    label: "Spouse",
    allowedSourceTypes: ["individual"],
    allowedTargetTypes: ["individual"],
    allowReverse: true,
    validationMessage: "Spouse relationships can only be between individuals.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "parent",
    label: "Parent",
    allowedSourceTypes: ["individual"],
    allowedTargetTypes: ["individual"],
    allowReverse: false,
    validationMessage: "Parent relationships can only be between individuals.",
    category: "governance",
    metadataFields: [],
  },
  {
    type: "child",
    label: "Child",
    allowedSourceTypes: ["individual"],
    allowedTargetTypes: ["individual"],
    allowReverse: false,
    validationMessage: "Child relationships can only be between individuals.",
    category: "governance",
    metadataFields: [],
  },
] as const;

// ── Lookup helpers ───────────────────────────────────────────────

const RULES_BY_TYPE = new Map<string, RelationshipRule>(
  RELATIONSHIP_RULES.map((r) => [r.type, r]),
);

export function getRuleForType(relationshipType: string): RelationshipRule | undefined {
  return RULES_BY_TYPE.get(relationshipType);
}

export function getRelationshipLabel(relationshipType: string): string {
  return RULES_BY_TYPE.get(relationshipType)?.label
    ?? relationshipType.charAt(0).toUpperCase() + relationshipType.slice(1);
}

// ── Bare trust beneficiary restriction ────────────────────────────

/** Bare trusts only allow Individual, Company, SMSF as beneficiaries */
const BARE_TRUST_TYPES = new Set(["trust_bare"]);

const BARE_TRUST_ALLOWED_BENEFICIARY_SOURCES: readonly CanonicalEntityCategory[] = [
  "individual",
  "company",
  "smsf",
];

export function isBareTrustBeneficiary(
  relationshipType: string,
  targetEntityType: string,
): boolean {
  return relationshipType === "beneficiary" && BARE_TRUST_TYPES.has(targetEntityType);
}

// ── Validation functions ─────────────────────────────────────────

/**
 * Check whether a relationship direction is valid according to the rules.
 * Returns true if valid or if no rule exists for the type.
 */
export function isDirectionValid(
  relationshipType: string,
  fromEntityType: string,
  toEntityType: string,
): boolean {
  const rule = RULES_BY_TYPE.get(relationshipType);
  if (!rule) return true; // No enforced rules for unknown types

  const sourceOk = matchesCategories(fromEntityType, rule.allowedSourceTypes);
  const targetOk = matchesCategories(toEntityType, rule.allowedTargetTypes);
  if (!sourceOk || !targetOk) return false;

  // Bare trusts restrict beneficiary source types
  if (isBareTrustBeneficiary(relationshipType, toEntityType)) {
    return matchesCategories(fromEntityType, BARE_TRUST_ALLOWED_BENEFICIARY_SOURCES);
  }

  return true;
}

/**
 * Return a user-friendly validation message if the direction is invalid,
 * or null if valid.
 */
export function getDirectionError(
  relationshipType: string,
  fromEntityType: string,
  toEntityType: string,
): string | null {
  if (isDirectionValid(relationshipType, fromEntityType, toEntityType)) return null;
  const rule = RULES_BY_TYPE.get(relationshipType);
  return rule?.validationMessage ?? `Invalid direction for ${relationshipType} relationship.`;
}

/**
 * Filter relationship types to only those valid for a given (from, to) entity pair.
 */
export function getValidRelationshipTypes(
  allTypes: readonly string[],
  fromEntityType: string,
  toEntityType: string,
): string[] {
  return allTypes.filter((t) => isDirectionValid(t, fromEntityType, toEntityType));
}

/**
 * Check if a relationship type has metadata (ownership) fields.
 */
export function hasMetadataFields(relationshipType: string): boolean {
  const rule = RULES_BY_TYPE.get(relationshipType);
  return (rule?.metadataFields.length ?? 0) > 0;
}

/**
 * Get allowed metadata fields for a relationship type.
 */
export function getMetadataFields(relationshipType: string): readonly MetadataField[] {
  return RULES_BY_TYPE.get(relationshipType)?.metadataFields ?? [];
}

/**
 * Check if a beneficiary relationship targets a discretionary trust.
 * Discretionary trusts don't have percentage/unit holdings — a person is
 * either a beneficiary or they're not.
 */
export function isDiscretionaryTrustBeneficiary(
  relationshipType: string,
  targetEntityType: string,
): boolean {
  if (relationshipType !== "beneficiary") return false;
  const cats = getCanonicalCategories(targetEntityType);
  return cats.includes("discretionary_trust");
}

/**
 * Get metadata fields filtered for context — hides ownership fields
 * for discretionary trust beneficiary relationships.
 */
export function getEffectiveMetadataFields(
  relationshipType: string,
  targetEntityType?: string,
): readonly MetadataField[] {
  if (targetEntityType && isDiscretionaryTrustBeneficiary(relationshipType, targetEntityType)) {
    return [];
  }
  return getMetadataFields(relationshipType);
}

/**
 * Check if reverse is allowed for a relationship type.
 */
export function isReverseAllowed(
  relationshipType: string,
  currentFromEntityType: string,
  currentToEntityType: string,
): boolean {
  const rule = RULES_BY_TYPE.get(relationshipType);
  if (!rule) return true;
  if (!rule.allowReverse) return false;
  // Even if allowReverse is true, the reversed direction must still be valid
  return isDirectionValid(relationshipType, currentToEntityType, currentFromEntityType);
}

/**
 * Generate the SQL CASE expression for the DB trigger.
 * This is exported for documentation/reference; the actual trigger
 * is maintained as a migration.
 */
export function generateValidationSQL(): string {
  const cases = RELATIONSHIP_RULES.map((r) => {
    const srcCats = r.allowedSourceTypes;
    const tgtCats = r.allowedTargetTypes;
    return `-- ${r.type}: ${r.validationMessage}`;
  }).join("\n");
  return cases;
}
