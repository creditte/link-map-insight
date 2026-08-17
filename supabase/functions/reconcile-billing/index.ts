// Admin-only billing reconciliation.
//
// Compares every tenant's mirrored billing state against Stripe and (optionally)
// applies corrections. Runs in dry-run mode by default: it always returns a full
// reconciliation summary of proposed changes, and only writes when
// { apply: true } is sent explicitly.
//
// Safe to rerun: all writes are absolute values derived from Stripe (not
// increments), and tenants already in sync are skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  STRIPE_API_VERSION,
  getSubscriptionLifecycle,
} from "../_shared/stripe-subscription.ts";
import { PLAN_DIAGRAM_LIMITS, resolvePlanFromSubscription } from "../_shared/stripe-plans.ts";
import { stripeVar } from "../_shared/stripe-env.ts";
import { tenantStripeRefs } from "../_shared/stripe-tenant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) =>
  console.log(`[reconcile-billing] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

const KNOWN_PLANS = new Set(Object.keys(PLAN_DIAGRAM_LIMITS));
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);

type TenantRow = {
  id: string;
  firm_name: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_mode?: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  selected_plan: string | null;
  diagram_limit: number | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  access_enabled: boolean | null;
  access_locked_reason: string | null;
};

const TENANT_COLUMNS =
  "id, firm_name, stripe_customer_id, stripe_subscription_id, stripe_mode, subscription_status, subscription_plan, selected_plan, diagram_limit, cancel_at_period_end, canceled_at, current_period_start, current_period_end, trial_ends_at, access_enabled, access_locked_reason";

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Diff proposed values against current row; returns only genuine changes. */
function diffChanges(tenant: TenantRow, proposed: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(proposed)) {
    const from = (tenant as Record<string, unknown>)[key] ?? null;
    const isDate = key.endsWith("_at") || key.endsWith("_start") || key.endsWith("_end");
    const equal = isDate
      ? sameInstant(from as string | null, (to as string | null) ?? null)
      : from === (to ?? null);
    if (!equal) changes[key] = { from, to: to ?? null };
  }
  return changes;
}

/** Pick the subscription that best represents the tenant's current state. */
function pickSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (!subs.length) return null;
  const rank = (s: Stripe.Subscription) => {
    if (s.status === "active" || s.status === "trialing") return 0;
    if (s.status === "past_due" || s.status === "unpaid") return 1;
    return 2;
  };
  return [...subs].sort((a, b) => rank(a) - rank(b) || (b.created ?? 0) - (a.created ?? 0))[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ---- Auth: platform super admins only ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: saRow } = await admin
      .from("super_admins")
      .select("id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (!saRow) return json({ error: "Forbidden" }, 403);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const apply = body?.apply === true;
    const tenantId: string | undefined = body?.tenantId || undefined;

    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);
    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

    log("started", { apply, tenantId: tenantId ?? "all", actor: caller.email });

    let query = admin.from("tenants").select(TENANT_COLUMNS);
    if (tenantId) query = query.eq("id", tenantId);
    const { data: tenants, error: tenantsError } = await query;
    if (tenantsError) return json({ error: tenantsError.message }, 500);

    const now = Date.now();
    const results: Array<Record<string, unknown>> = [];
    const issues: Array<Record<string, unknown>> = [];
    let inSync = 0;
    let applied = 0;

    for (const tenant of (tenants ?? []) as TenantRow[]) {
      const notes: string[] = [];
      let proposed: Record<string, unknown> = {};
      let subscription: Stripe.Subscription | null = null;

      // Stripe references from another mode are legacy data — never query the
      // active Stripe environment with them.
      const refs = tenantStripeRefs(tenant as any);
      if (refs.isLegacy) {
        skipped.push({ tenant_id: tenant.id, reason: `legacy ${refs.storedMode}-mode Stripe ids (active mode=${refs.mode})` });
        continue;
      }

      // ---- 1. Retrieve the current Stripe subscription ----
      if (tenant.stripe_subscription_id) {
        try {
          subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
        } catch (e) {
          notes.push(`stripe_subscription_id could not be retrieved: ${(e as Error).message}`);
        }
      }
      if (!subscription && tenant.stripe_customer_id) {
        try {
          const list = await stripe.subscriptions.list({
            customer: tenant.stripe_customer_id,
            status: "all",
            limit: 20,
          });
          subscription = pickSubscription(list.data);
          if (subscription && subscription.id !== tenant.stripe_subscription_id) {
            notes.push(`resolved subscription from customer: ${subscription.id}`);
          }
        } catch (e) {
          notes.push(`customer subscriptions lookup failed: ${(e as Error).message}`);
        }
      }

      if (subscription) {
        const lc = getSubscriptionLifecycle(subscription);

        // ---- 2. Backfill mirrored lifecycle fields ----
        proposed = {
          stripe_subscription_id: subscription.id,
          subscription_status: lc.status,
          current_period_start: lc.currentPeriodStart,
          current_period_end: lc.currentPeriodEnd,
          cancel_at_period_end: lc.cancelAtPeriodEnd,
          canceled_at: lc.canceledAt,
        };
        if (lc.trialEnd) proposed.trial_ends_at = lc.trialEnd;

        // Plan + diagram limit strictly from configured Stripe mappings.
        try {
          const { plan, diagramLimit } = resolvePlanFromSubscription(subscription, "reconcile-billing");
          proposed.subscription_plan = plan;
          if (ACTIVE_STRIPE_STATUSES.has(lc.status)) proposed.diagram_limit = diagramLimit;
        } catch (e) {
          notes.push(`plan not resolved (left untouched): ${(e as Error).message}`);
          issues.push({
            tenant_id: tenant.id,
            firm_name: tenant.firm_name,
            issue: "unmapped_stripe_product",
            subscription_id: subscription.id,
          });
        }
      } else if (tenant.stripe_customer_id || tenant.stripe_subscription_id) {
        notes.push("no Stripe subscription found for this customer");
      }

      // ---- 3. Expire stale trials not backed by an active Stripe subscription ----
      const stripeActive = subscription
        ? ACTIVE_STRIPE_STATUSES.has(subscription.status)
        : false;
      const effectiveStatus = (proposed.subscription_status as string) ?? tenant.subscription_status;
      const trialEnd = (proposed.trial_ends_at as string) ?? tenant.trial_ends_at;
      if (
        !stripeActive &&
        effectiveStatus === "trialing" &&
        trialEnd &&
        new Date(trialEnd).getTime() < now
      ) {
        proposed.subscription_status = "trial_expired";
        proposed.access_enabled = false;
        proposed.access_locked_reason = "trial_expired";
        notes.push("stale trial expired");
      }

      // ---- 4. Normalize selected_plan without clobbering pending changes ----
      const resolvedPlan = (proposed.subscription_plan as string) ?? tenant.subscription_plan;
      const currentSelected = tenant.selected_plan;
      const selectedIsValid = !!currentSelected && KNOWN_PLANS.has(currentSelected);
      const pendingChange =
        selectedIsValid && !!resolvedPlan && currentSelected !== resolvedPlan && stripeActive;
      if (!pendingChange && resolvedPlan && currentSelected !== resolvedPlan) {
        if (!selectedIsValid) {
          proposed.selected_plan = resolvedPlan;
          notes.push(`selected_plan normalized (was ${currentSelected ?? "null"})`);
        } else if (!stripeActive) {
          proposed.selected_plan = resolvedPlan;
          notes.push("selected_plan aligned to subscription plan (no active subscription)");
        }
      } else if (pendingChange) {
        notes.push(`pending plan change preserved: ${resolvedPlan} → ${currentSelected}`);
      }

      const changes = diffChanges(tenant, proposed);
      if (Object.keys(changes).length === 0) {
        inSync++;
        continue;
      }

      // ---- 5/6. Apply only when explicitly requested; idempotent absolute writes ----
      let status = "pending";
      if (apply) {
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(changes)) patch[key] = changes[key].to;
        patch.updated_at = new Date().toISOString();
        const { error: updateError } = await admin.from("tenants").update(patch).eq("id", tenant.id);
        if (updateError) {
          status = "failed";
          notes.push(`update failed: ${updateError.message}`);
          issues.push({ tenant_id: tenant.id, issue: "update_failed", detail: updateError.message });
        } else {
          status = "applied";
          applied++;
        }
      }

      results.push({
        tenant_id: tenant.id,
        firm_name: tenant.firm_name,
        stripe_customer_id: tenant.stripe_customer_id,
        subscription_id: subscription?.id ?? null,
        status,
        changes,
        notes,
      });
    }

    const summary = {
      mode: apply ? "apply" : "dry_run",
      run_at: new Date().toISOString(),
      run_by: caller.email,
      tenants_scanned: tenants?.length ?? 0,
      tenants_in_sync: inSync,
      tenants_needing_changes: results.length,
      tenants_updated: applied,
      issues_count: issues.length,
    };

    log("finished", summary);
    return json({ summary, tenants: results, issues });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reconcile-billing] ERROR", message);
    return json({ error: message }, 500);
  }
});
