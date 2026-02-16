/**
 * Canonical direction rules for relationship types.
 *
 * Each entry maps a relationship_type to a set of allowed
 * (fromType, toType) patterns. Entity types use the same values
 * stored in the `entities.entity_type` column.
 *
 * "any" matches every entity type. A group prefix like "trust_*"
 * matches all trust sub-types plus legacy "Trust".
 */

const TRUST_TYPES = new Set([
  "Trust",
  "trust_discretionary",
  "trust_unit",
  "trust_hybrid",
  "trust_bare",
  "trust_testamentary",
  "trust_deceased_estate",
  "trust_family",
]);

function isTrustType(t: string): boolean {
  return TRUST_TYPES.has(t);
}

interface DirectionRule {
  fromTypes: string[] | "any";
  toTypes: string[] | "any";
}

/**
 * Enforced canonical directions.
 * A reversal is blocked if the *reversed* direction would NOT match
 * at least one rule for that relationship_type.
 */
export const CANONICAL_DIRECTION_RULES: Record<string, DirectionRule[]> = {
  director: [{ fromTypes: ["Individual"], toTypes: ["Company"] }],
  trustee: [{ fromTypes: ["Individual", "Company"], toTypes: "any" }], // to trust-type entities
  appointer: [{ fromTypes: ["Individual", "Company"], toTypes: "any" }],
  settlor: [{ fromTypes: ["Individual", "Company"], toTypes: "any" }],
  member: [{ fromTypes: ["Individual"], toTypes: ["smsf"] }],
  beneficiary: [{ fromTypes: ["Individual", "Company"], toTypes: "any" }],
};

// For trustee/appointer/settlor/beneficiary the "to" side should be a trust or smsf
const TRUST_TARGET_TYPES = new Set(["trustee", "appointer", "settlor", "beneficiary"]);

/**
 * Check whether a relationship direction is valid according to canonical rules.
 * Returns true if the direction is allowed (or if no rule exists for the type).
 */
export function isDirectionValid(
  relationshipType: string,
  fromEntityType: string,
  toEntityType: string,
): boolean {
  const rules = CANONICAL_DIRECTION_RULES[relationshipType];
  if (!rules) return true; // No enforced direction for this type

  for (const rule of rules) {
    const fromOk = rule.fromTypes === "any" || rule.fromTypes.includes(fromEntityType);
    let toOk = rule.toTypes === "any" || rule.toTypes.includes(toEntityType);

    // For trust-targeted types, refine "any" to require trust/smsf on the to-side
    if (TRUST_TARGET_TYPES.has(relationshipType) && rule.toTypes === "any") {
      toOk = isTrustType(toEntityType) || toEntityType === "smsf";
    }

    if (fromOk && toOk) return true;
  }

  return false;
}
