import { Building2, User, Landmark, Users, Store, Building, Shield, type LucideIcon } from "lucide-react";

export const ENTITY_TYPES = [
  "Individual",
  "Company",
  "Partnership",
  "Sole Trader",
  "Incorporated Association/Club",
  "trust_discretionary",
  "trust_unit",
  "trust_hybrid",
  "trust_bare",
  "trust_testamentary",
  "trust_deceased_estate",
  "trust_family",
  "smsf",
  "Unclassified",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** Friendly display labels for each entity_type value */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  Individual: "Individual",
  Company: "Company",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  "Incorporated Association/Club": "Incorporated Association/Club",
  trust_discretionary: "Discretionary Trust",
  trust_unit: "Unit Trust",
  trust_hybrid: "Hybrid Trust",
  trust_bare: "Bare Trust",
  trust_testamentary: "Testamentary Trust",
  trust_deceased_estate: "Deceased Estate",
  trust_family: "Family Trust",
  smsf: "SMSF",
  Unclassified: "Unclassified",
  // Legacy value (should not appear after migration)
  Trust: "Trust",
};

export function getEntityLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

/** Icon for each entity type */
export const ENTITY_ICON_MAP: Record<string, LucideIcon> = {
  Individual: User,
  Company: Building2,
  Partnership: Users,
  "Sole Trader": Store,
  "Incorporated Association/Club": Building,
  trust_discretionary: Landmark,
  trust_unit: Landmark,
  trust_hybrid: Landmark,
  trust_bare: Landmark,
  trust_testamentary: Landmark,
  trust_deceased_estate: Landmark,
  trust_family: Landmark,
  smsf: Shield,
  Unclassified: User,
  Trust: Landmark,
};

export function getEntityIcon(entityType: string): LucideIcon {
  return ENTITY_ICON_MAP[entityType] ?? User;
}

/** Tailwind color classes for node styling */
export const ENTITY_COLOR_MAP: Record<string, string> = {
  Individual: "bg-blue-50 border-blue-300 dark:bg-blue-950 dark:border-blue-700",
  Company: "bg-emerald-50 border-emerald-300 dark:bg-emerald-950 dark:border-emerald-700",
  Partnership: "bg-purple-50 border-purple-300 dark:bg-purple-950 dark:border-purple-700",
  "Sole Trader": "bg-rose-50 border-rose-300 dark:bg-rose-950 dark:border-rose-700",
  "Incorporated Association/Club": "bg-cyan-50 border-cyan-300 dark:bg-cyan-950 dark:border-cyan-700",
  trust_discretionary: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_unit: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_hybrid: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_bare: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_testamentary: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_deceased_estate: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  trust_family: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  smsf: "bg-orange-50 border-orange-300 dark:bg-orange-950 dark:border-orange-700",
  Unclassified: "bg-muted border-border",
  Trust: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
};

export function getEntityColor(entityType: string): string {
  return ENTITY_COLOR_MAP[entityType] ?? ENTITY_COLOR_MAP.Unclassified;
}
