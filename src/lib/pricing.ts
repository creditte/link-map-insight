// Single source of truth for every price shown in the UI.
// These strings are display-only — the amount actually charged always comes from
// the Stripe price configured in the STRIPE_*_PRICE_ID environment variables.
// Never derive a plan from a fallback: unknown plans must surface an error.

export type BillingInterval = "monthly" | "annual";
export type PlanId = "starter" | "pro" | "enterprise";

export interface PlanPricing {
  id: PlanId;
  name: string;
  tagline: string;
  /** Cents (AUD). Null when there is no self-service price for that interval. */
  monthlyAmount: number | null;
  annualAmount: number | null;
  monthlyLabel: string | null;
  annualLabel: string | null;
  /** Structure-group allowance on the paid plan. Null = negotiated. */
  groupLimit: number | null;
  features: string[];
  /** Self-service Stripe checkout, or a sales/contact flow. */
  checkout: "self_service" | "contact_sales";
  highlight?: boolean;
}

export const ANNUAL_SAVING_LABEL = "Save 2 months";

/** Trial entitlement — Pro features, 3 structure groups, 7 days. */
export const TRIAL = {
  days: 7,
  groupLimit: 3,
  featureTier: "pro" as const,
};

export const PLAN_GROUP_LIMITS: Record<"starter" | "pro", number> = {
  starter: 15,
  pro: 50,
};

export const SALES_EMAIL = "hello@strukcha.app";

export const PLANS: Record<PlanId, PlanPricing> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Core structure mapping for smaller firms.",
    monthlyAmount: 9900,
    annualAmount: 99000,
    monthlyLabel: "A$99/month",
    annualLabel: "A$990/year",
    groupLimit: 15,
    features: [
      "Up to 15 structure groups",
      "Xero Practice Manager import",
      "Visual structure diagrams",
      "Core relationship mapping",
      "PDF export",
    ],
    checkout: "self_service",
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Everything in Starter plus AI Review reports.",
    monthlyAmount: 24900,
    annualAmount: 249000,
    monthlyLabel: "A$249/month",
    annualLabel: "A$2,490/year",
    groupLimit: 50,
    features: [
      "Up to 50 structure groups",
      "AI Review — Explain, Audit and Improve reports",
      "Advanced relationship editing and scenarios",
      "Structure health scoring and snapshots",
      "Branded export packs",
      "Priority email support",
    ],
    checkout: "self_service",
    highlight: true,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Multi-office firms and networks.",
    monthlyAmount: null,
    annualAmount: 599000,
    monthlyLabel: null,
    annualLabel: "From A$5,990/year",
    groupLimit: null,
    features: [
      "Unlimited structure groups",
      "Multiple users and offices",
      "Onboarding and data migration support",
      "Security review and custom agreements",
      "Dedicated account manager",
    ],
    checkout: "contact_sales",
  },
};

/** Display price for a plan at a given interval. Enterprise always shows its annual floor. */
export function priceLabel(plan: PlanPricing, interval: BillingInterval): string {
  if (plan.checkout === "contact_sales") return plan.annualLabel ?? "Contact sales";
  const label = interval === "annual" ? plan.annualLabel : plan.monthlyLabel;
  if (!label) throw new Error(`No ${interval} price configured for plan "${plan.id}"`);
  return label;
}

/** Renewal copy from live Stripe values, falling back to the configured plan label. */
export function renewalLabel(
  plan: string | null | undefined,
  interval: string | null | undefined,
  priceAmountCents: number | null | undefined,
): string {
  const isAnnual = interval === "year" || interval === "annual";
  if (typeof priceAmountCents === "number" && priceAmountCents > 0) {
    const amount = (priceAmountCents / 100).toLocaleString("en-AU");
    return isAnnual ? `A$${amount}/year` : `A$${amount}/month`;
  }
  const config = plan === "starter" ? PLANS.starter : plan === "pro" ? PLANS.pro : null;
  if (!config) return "your plan price";
  return priceLabel(config, isAnnual ? "annual" : "monthly");
}

export function planDisplayName(plan: string | null | undefined): string {
  if (plan === "starter") return "strukcha Starter";
  if (plan === "pro") return "strukcha Pro";
  if (plan === "enterprise") return "strukcha Enterprise";
  return "strukcha";
}
