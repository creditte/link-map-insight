// Mode-aware handling of tenant Stripe references.
//
// Problem this solves:
// Stripe customer/subscription IDs are scoped to ONE account+mode. IDs created in
// the sandbox (test) account do not exist in live mode, so calling the live API with
// a sandbox `cus_…` returns `No such customer: cus_…`.
//
// Rules enforced here:
//   * `tenants.stripe_mode` records the mode the stored IDs belong to.
//     Rows written before this column existed are treated as "test".
//   * When the stored mode differs from the active mode, the IDs are LEGACY:
//     never sent to Stripe, never overwritten in place. They are moved to
//     `legacy_stripe_*` columns (quarantine) so nothing is lost, and the active
//     columns are cleared so a fresh, correct customer can be created once — no duplicates.

import { stripeMode, type StripeMode } from "./stripe-env.ts";

export interface TenantStripeFields {
  id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_mode?: string | null;
}

export interface TenantStripeRefs {
  /** Active Stripe mode for this environment. */
  mode: StripeMode;
  /** Mode the stored IDs belong to ("test" for pre-migration rows). */
  storedMode: StripeMode;
  /** True when stored IDs belong to a different Stripe mode than the active one. */
  isLegacy: boolean;
  /** Customer ID safe to use with the active Stripe key (null when legacy/absent). */
  customerId: string | null;
  /** Subscription ID safe to use with the active Stripe key (null when legacy/absent). */
  subscriptionId: string | null;
}

export function tenantStripeRefs(tenant: TenantStripeFields): TenantStripeRefs {
  const mode = stripeMode();
  const raw = (tenant.stripe_mode ?? "").trim().toLowerCase();
  const hasIds = !!(tenant.stripe_customer_id || tenant.stripe_subscription_id);
  // Unset mode + existing IDs = created before mode tracking = sandbox/test data.
  const storedMode: StripeMode = raw === "live" ? "live" : raw === "test" ? "test" : hasIds ? "test" : mode;
  const isLegacy = hasIds && storedMode !== mode;

  return {
    mode,
    storedMode,
    isLegacy,
    customerId: isLegacy ? null : tenant.stripe_customer_id ?? null,
    subscriptionId: isLegacy ? null : tenant.stripe_subscription_id ?? null,
  };
}

/** Stripe "resource_missing" (No such customer/subscription) detection. */
export function isStripeMissingResource(err: unknown): boolean {
  const e = err as any;
  if (!e) return false;
  if (e.code === "resource_missing" || e?.raw?.code === "resource_missing") return true;
  const msg = String(e.message ?? "");
  return /No such (customer|subscription|price|product)/i.test(msg);
}

/**
 * Move mode-mismatched (or provably missing) Stripe IDs into the legacy columns.
 * Never deletes them; never writes a Stripe ID from another mode into the active columns.
 * Returns true when a quarantine actually happened.
 */
export async function quarantineLegacyStripeRefs(
  supabaseAdmin: any,
  tenant: TenantStripeFields,
  reason: string,
): Promise<boolean> {
  if (!tenant.stripe_customer_id && !tenant.stripe_subscription_id) return false;
  const refs = tenantStripeRefs(tenant);

  const update: Record<string, any> = {
    legacy_stripe_customer_id: tenant.stripe_customer_id ?? null,
    legacy_stripe_subscription_id: tenant.stripe_subscription_id ?? null,
    legacy_stripe_mode: refs.storedMode,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_mode: refs.mode,
    // The vaulted card lived in the other Stripe account — it is not usable here.
    payment_method_captured: false,
  };

  const { error } = await supabaseAdmin.from("tenants").update(update).eq("id", tenant.id);
  if (error) {
    console.error(`[stripe-tenant] Failed to quarantine legacy refs for ${tenant.id}: ${error.message}`);
    return false;
  }

  console.log(
    `[stripe-tenant] Quarantined ${refs.storedMode}-mode Stripe refs for tenant ${tenant.id} (active mode=${refs.mode}, reason=${reason}): customer=${tenant.stripe_customer_id} subscription=${tenant.stripe_subscription_id}`,
  );
  tenant.stripe_customer_id = null;
  tenant.stripe_subscription_id = null;
  tenant.stripe_mode = refs.mode;
  return true;
}

/** Standard user-facing error for legacy (other-mode) subscriptions. */
export const LEGACY_SUBSCRIPTION_MESSAGE =
  "This subscription was created in a different Stripe environment (test mode) and can no longer be managed. Please start a new subscription to continue.";
