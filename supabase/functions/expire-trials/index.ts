// Scheduled trial expiry.
//
// Finds tenants whose trial has lapsed and that have no live Stripe subscription,
// then locks them out. Intended to be invoked by pg_cron with the service role key.
//
// Idempotent: it only ever transitions rows that are still `trialing` with a past
// `trial_ends_at`, and all writes are absolute values (no increments). Re-running
// it immediately afterwards is a no-op.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { isServiceRoleRequest } from "../_shared/cron-auth.ts";
import { stripeVar } from "../_shared/stripe-env.ts";
import { tenantStripeRefs } from "../_shared/stripe-tenant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) =>
  console.log(`[expire-trials] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

/** Stripe statuses that mean the customer still has a live subscription. */
const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey || !isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  const stripeKey = stripeVar("STRIPE_SECRET_KEY");
  const stripe = stripeKey
    ? new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION })
    : null;

  const nowIso = new Date().toISOString();
  const expired: string[] = [];
  const skipped: Array<{ tenant_id: string; reason: string }> = [];

  try {
    const { data: tenants, error } = await supabase
      .from("tenants")
      .select("id, firm_name, trial_ends_at, stripe_subscription_id, stripe_customer_id, stripe_mode")
      .eq("subscription_status", "trialing")
      .not("trial_ends_at", "is", null)
      .lt("trial_ends_at", nowIso);

    if (error) throw error;

    log("candidates", { count: tenants?.length ?? 0 });

    for (const tenant of tenants ?? []) {
      // A live Stripe subscription always wins over the local trial window:
      // the webhook/self-heal path owns those tenants.
      const refs = tenantStripeRefs(tenant as any);
      if (refs.isLegacy) {
        // Legacy (other Stripe mode) ids: treat the tenant as having no live
        // subscription rather than calling Stripe with an unknown id.
        log("legacy stripe ids ignored", { tenant_id: tenant.id, stored_mode: refs.storedMode });
      }
      if (refs.subscriptionId && stripe) {
        try {
          const sub = await stripe.subscriptions.retrieve(refs.subscriptionId);
          if (LIVE_STRIPE_STATUSES.has(sub.status)) {
            skipped.push({ tenant_id: tenant.id, reason: `stripe_${sub.status}` });
            continue;
          }
        } catch (e) {
          // Never lock a tenant out because Stripe was unreachable.
          log("stripe lookup failed, skipping", {
            tenant_id: tenant.id,
            message: e instanceof Error ? e.message : String(e),
          });
          skipped.push({ tenant_id: tenant.id, reason: "stripe_lookup_failed" });
          continue;
        }
      } else if (refs.subscriptionId && !stripe) {
        skipped.push({ tenant_id: tenant.id, reason: "stripe_not_configured" });
        continue;
      }

      // Guarded update: the status filter keeps this safe against concurrent runs.
      const { error: updateError } = await supabase
        .from("tenants")
        .update({
          subscription_status: "trial_expired",
          access_enabled: false,
          access_locked_reason: "trial_expired",
        })
        .eq("id", tenant.id)
        .eq("subscription_status", "trialing");

      if (updateError) {
        log("update failed", { tenant_id: tenant.id, message: updateError.message });
        skipped.push({ tenant_id: tenant.id, reason: "update_failed" });
        continue;
      }

      expired.push(tenant.id);
      log("expired", { tenant_id: tenant.id, firm_name: tenant.firm_name });
    }

    return new Response(
      JSON.stringify({ ok: true, checked: tenants?.length ?? 0, expired, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
