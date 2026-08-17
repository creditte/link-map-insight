import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { invokeTransactionalEmail } from "../_shared/invoke-transactional-email.ts";
import { getTenantBillingRecipients } from "../_shared/tenant-recipients.ts";
import {
  STRIPE_API_VERSION,
  getInvoicePeriodEnd,
  getInvoiceSubscriptionId,
  getSubscriptionLifecycle,
  getTrialEndSeconds,
  toISO,
} from "../_shared/stripe-subscription.ts";
import {
  buildPlanConfig,
  buildPriceMap,
  resolvePlanFromSubscription as sharedResolvePlan,
} from "../_shared/stripe-plans.ts";
import { stripeVar, stripeMode } from "../_shared/stripe-env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Plan configuration mapped by Stripe Product ID — single source of truth in _shared/stripe-plans.ts
// Trials always get the capped trial allowance (full Pro features, 3 structure groups);
// plan limits apply once the subscription is paying.
const TRIAL_GROUP_LIMIT = 3;

const PLAN_CONFIG: Record<string, { plan: string; diagramLimit: number }> = {};

const PRICE_MAP = buildPriceMap();

function initPlanConfig() {
  for (const [id, cfg] of Object.entries(buildPlanConfig())) {
    PLAN_CONFIG[id] = cfg;
  }
}

function resolvePlanFromSubscription(
  subscription: Stripe.Subscription,
): { plan: string; diagramLimit: number } {
  return sharedResolvePlan(subscription, "stripe-webhooks");
}

async function findTenantByCustomer(supabaseAdmin: any, customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

async function notifyTenantBilling(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
  templateName: string,
  templateData: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("firm_name, subscription_plan")
    .eq("id", tenantId)
    .maybeSingle();

  const recipients = await getTenantBillingRecipients(supabaseAdmin, tenantId);
  for (const recipient of recipients) {
    await invokeTransactionalEmail({
      templateName,
      recipientEmail: recipient.email,
      templateData: {
        name: recipient.name,
        firmName: tenant?.firm_name,
        plan: tenant?.subscription_plan,
        ...templateData,
      },
      idempotencyKey: `${idempotencyKey}:${recipient.email}`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = stripeVar("STRIPE_SECRET_KEY");
  const webhookSecret = stripeVar("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Server misconfigured", { status: 500 });
  }

  initPlanConfig();

  const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Mode guard: a webhook from the other Stripe environment must never mutate
  // tenant billing state in this one (test events cannot be trusted in live mode).
  const activeModeIsLive = stripeMode() === "live";
  if (event.livemode !== activeModeIsLive) {
    console.warn(
      `[stripe-webhooks] Ignoring ${event.type} (${event.id}): event livemode=${event.livemode} but active mode=${activeModeIsLive ? "live" : "test"}`,
    );
    return new Response(JSON.stringify({ received: true, ignored: "mode_mismatch" }), { status: 200 });
  }



  // Idempotency: only events that fully completed are skipped. Rows left in
  // 'processing'/'failed' state are re-processed on Stripe's retry.
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id, status, attempts")
    .eq("id", event.id)
    .maybeSingle();

  if (existing?.status === "completed") {
    console.log(`Event ${event.id} already processed, skipping`);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const attempts = (existing?.attempts ?? 0) + 1;

  // Claim the event: insert on first delivery, or re-claim a previously failed one.
  const { error: claimError } = await supabaseAdmin
    .from("stripe_webhook_events")
    .upsert({
      id: event.id,
      event_type: event.type,
      payload: event.data.object as any,
      status: "processing",
      attempts,
      last_error: null,
      completed_at: null,
      processed_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (claimError) {
    console.error(`[stripe-webhooks] Failed to claim event ${event.id}:`, claimError.message);
    return new Response(
      JSON.stringify({ error: "Failed to record webhook event" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`Processing webhook: ${event.type} (${event.id}) attempt=${attempts}`);


  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspace_id;
        if (!workspaceId) break;

        if (!session.subscription) {
          console.error(
            `[stripe-webhooks] checkout.session.completed without subscription for workspace=${workspaceId} session=${session.id} — refusing to activate.`,
          );
          throw new Error("Checkout session has no subscription; cannot activate plan without a mapped product.");
        }

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        const { plan, diagramLimit } = resolvePlanFromSubscription(sub);
        const life = getSubscriptionLifecycle(sub);
        const periodStart = life.currentPeriodStart;
        const periodEnd = life.currentPeriodEnd;
        const status = life.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          stripe_subscription_id: sub.id,
          stripe_customer_id: session.customer as string,
          stripe_mode: stripeMode(),
          payment_method_captured: true,
          payment_setup_completed_at: new Date().toISOString(),
          trial_used_at: new Date().toISOString(),
          subscription_status: status,
          subscription_plan: plan,
          selected_plan: plan,
          access_enabled: accessEnabled,
          access_locked_reason: accessEnabled
            ? null
            : (status === "canceled" ? "subscription_canceled" : `subscription_${status}`),
          diagram_limit: status === "trialing" ? TRIAL_GROUP_LIMIT : diagramLimit,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: life.cancelAtPeriodEnd,
          canceled_at: life.canceledAt,
          trial_ends_at: life.trialEnd,
        };

        await supabaseAdmin
          .from("tenants")
          .update(updateData)
          .eq("id", workspaceId);
        console.log(`Tenant ${workspaceId} checkout completed: plan=${plan}, status=${status}, limit=${diagramLimit}, period_end=${periodEnd}`);

        // The welcome email is deliberately NOT sent here. It is sent once the firm has
        // connected Xero Practice Manager (see xero-callback / xero-finalise-connection),
        // because that is when the product is actually usable.

        break;
      }



      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const workspaceId = subscription.metadata?.workspace_id;

        let tenantId = workspaceId;
        if (!tenantId) {
          tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string);
        }
        if (!tenantId) {
          console.error("No tenant found for subscription", subscription.id);
          break;
        }

        const { plan, diagramLimit } = resolvePlanFromSubscription(subscription);
        const life = getSubscriptionLifecycle(subscription);
        const status = life.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          subscription_status: status,
          subscription_plan: plan,
          selected_plan: plan, // Sync selected_plan to actual plan on Stripe changes
          stripe_subscription_id: subscription.id,
          stripe_mode: stripeMode(),
          current_period_start: life.currentPeriodStart,
          current_period_end: life.currentPeriodEnd,
          cancel_at_period_end: life.cancelAtPeriodEnd,
          canceled_at: life.canceledAt,
          access_enabled: accessEnabled,
          access_locked_reason: accessEnabled ? null : (status === "canceled" ? "subscription_canceled" : `subscription_${status}`),
          diagram_limit: status === "trialing" ? TRIAL_GROUP_LIMIT : diagramLimit,
          payment_method_captured: true,
        };

        if (life.trialEnd) {
          updateData.trial_ends_at = life.trialEnd;
          updateData.trial_used_at = updateData.trial_used_at ?? new Date().toISOString();
        }

        await supabaseAdmin.from("tenants").update(updateData).eq("id", tenantId);
        console.log(`Updated tenant ${tenantId}: plan=${plan}, status=${status}, limit=${diagramLimit}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string);

        if (tenantId) {
          const { data: tenantBefore } = await supabaseAdmin
            .from("tenants")
            .select("access_locked_reason")
            .eq("id", tenantId)
            .maybeSingle();

          const paymentFailed = tenantBefore?.access_locked_reason === "payment_failed";

          await supabaseAdmin
            .from("tenants")
            .update({
              subscription_status: "canceled",
              access_enabled: false,
              access_locked_reason: "subscription_canceled",
              canceled_at: getSubscriptionLifecycle(subscription).canceledAt ??
                getSubscriptionLifecycle(subscription).endedAt ??
                new Date().toISOString(),
              cancel_at_period_end: false,
            })
            .eq("id", tenantId);
          console.log(`Tenant ${tenantId} subscription deleted, access locked`);

          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "subscription-canceled",
            {
              reason: paymentFailed ? "payment_failed" : "canceled",
              accessEndsAt: new Date().toISOString(),
            },
            `stripe:${event.id}:subscription-canceled`,
          );
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);

        if (tenantId) {
          // Restore access
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: true,
              access_locked_reason: null,
            })
            .eq("id", tenantId);

          // Check for pending downgrade: if selected_plan differs from subscription_plan,
          // apply the plan change in Stripe now that the new period has started
          const { data: tenant } = await supabaseAdmin
            .from("tenants")
            .select("subscription_plan, selected_plan, stripe_subscription_id")
            .eq("id", tenantId)
            .single();

          if (
            tenant &&
            tenant.selected_plan &&
            tenant.selected_plan !== tenant.subscription_plan &&
            tenant.stripe_subscription_id
          ) {
            console.log(`Tenant ${tenantId}: applying deferred plan change ${tenant.subscription_plan} → ${tenant.selected_plan}`);

            try {
              const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
              const currentItem = sub.items.data[0];
              if (currentItem) {
                const currentInterval = currentItem.price.recurring?.interval || "month";
                const targetPriceId = PRICE_MAP[tenant.selected_plan]?.[currentInterval];

                if (targetPriceId) {
                  const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
                    items: [{ id: currentItem.id, price: targetPriceId }],
                    proration_behavior: "none",
                  });

                  // Resolve the new limit strictly from the updated Stripe subscription's product mapping.
                  const { plan: resolvedPlan, diagramLimit: newLimit } = resolvePlanFromSubscription(updatedSub);
                  const updatedLife = getSubscriptionLifecycle(updatedSub);
                  const deferredUpdate: Record<string, any> = {
                    subscription_plan: resolvedPlan,
                    selected_plan: resolvedPlan,
                    diagram_limit: newLimit,
                  };
                  if (updatedLife.currentPeriodStart) deferredUpdate.current_period_start = updatedLife.currentPeriodStart;
                  if (updatedLife.currentPeriodEnd) deferredUpdate.current_period_end = updatedLife.currentPeriodEnd;
                  await supabaseAdmin.from("tenants").update(deferredUpdate).eq("id", tenantId);

                  console.log(`Tenant ${tenantId}: deferred plan change applied to ${resolvedPlan} (limit=${newLimit})`);
                } else {
                  console.error(`No price ID for plan=${tenant.selected_plan}, interval=${currentInterval} — deferred plan change aborted, no benefits granted.`);
                }
              }
            } catch (e: any) {
              console.error(`Failed to apply deferred plan change for tenant ${tenantId}:`, e.message);
            }
          }

          // Re-sync billing period bounds from the subscription (invoice payloads
          // no longer carry them at the top level in recent API versions).
          const invoiceSubId = getInvoiceSubscriptionId(invoice) ?? tenant?.stripe_subscription_id;
          if (invoiceSubId) {
            try {
              const paidSub = await stripe.subscriptions.retrieve(invoiceSubId);
              const paidLife = getSubscriptionLifecycle(paidSub);
              const periodUpdate: Record<string, any> = {
                subscription_status: paidLife.status,
                cancel_at_period_end: paidLife.cancelAtPeriodEnd,
              };
              if (paidLife.currentPeriodStart) periodUpdate.current_period_start = paidLife.currentPeriodStart;
              if (paidLife.currentPeriodEnd) periodUpdate.current_period_end = paidLife.currentPeriodEnd;
              if (paidLife.trialEnd) periodUpdate.trial_ends_at = paidLife.trialEnd;
              await supabaseAdmin.from("tenants").update(periodUpdate).eq("id", tenantId);
            } catch (e: any) {
              console.error(`[stripe-webhooks] invoice.paid period sync failed for tenant ${tenantId}:`, e.message);
            }
          }

          console.log(`Tenant ${tenantId} invoice paid, access restored`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);

        if (tenantId) {
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: false,
              access_locked_reason: "payment_failed",
              subscription_status: "past_due",
            })
            .eq("id", tenantId);
          console.log(`Tenant ${tenantId} payment failed, access locked`);

          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "payment-failed",
            {},
            `stripe:${event.id}:payment-failed`,
          );
        }
        break;
      }

      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        let tenantId = subscription.metadata?.workspace_id as string | undefined;
        if (!tenantId) {
          tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string) ?? undefined;
        }
        const trialEndSeconds = getTrialEndSeconds(subscription);
        if (!tenantId) {
          console.warn(
            `[stripe-webhooks] trial_will_end: no tenant resolved for subscription=${subscription.id} customer=${subscription.customer}`,
          );
          break;
        }
        if (!trialEndSeconds) {
          console.warn(
            `[stripe-webhooks] trial_will_end: no trial_end on subscription=${subscription.id} (tenant=${tenantId})`,
          );
          break;
        }
        const trialEndIso = toISO(trialEndSeconds)!;
        const daysRemaining = Math.max(
          1,
          Math.ceil((trialEndSeconds * 1000 - Date.now()) / (24 * 60 * 60 * 1000)),
        );

        const { error: trialUpdateError } = await supabaseAdmin
          .from("tenants")
          .update({ trial_ends_at: trialEndIso })
          .eq("id", tenantId);
        if (trialUpdateError) {
          throw new Error(`Failed to update trial_ends_at for tenant ${tenantId}: ${trialUpdateError.message}`);
        }

        await notifyTenantBilling(
          supabaseAdmin,
          tenantId,
          "trial-ending",
          { trialEndsAt: trialEndIso, daysRemaining },
          `stripe:${event.id}:trial-ending`,
        );
        console.log(
          `[stripe-webhooks] trial_will_end handled: tenant=${tenantId} subscription=${subscription.id} trial_ends_at=${trialEndIso} days_remaining=${daysRemaining}`,
        );
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let tenantId = session.metadata?.workspace_id as string | undefined;
        if (!tenantId && session.customer) {
          tenantId = await findTenantByCustomer(supabaseAdmin, session.customer as string) ?? undefined;
        }
        if (!tenantId) {
          console.warn(
            `[stripe-webhooks] async_payment_failed: no tenant resolved for session=${session.id} customer=${session.customer}`,
          );
          break;
        }

        const { error: lockError } = await supabaseAdmin
          .from("tenants")
          .update({
            access_enabled: false,
            access_locked_reason: "payment_failed",
          })
          .eq("id", tenantId);
        if (lockError) {
          throw new Error(`Failed to lock tenant ${tenantId} after async payment failure: ${lockError.message}`);
        }

        await notifyTenantBilling(
          supabaseAdmin,
          tenantId,
          "payment-failed",
          {},
          `stripe:${event.id}:payment-failed`,
        );
        console.log(
          `[stripe-webhooks] async_payment_failed handled: tenant=${tenantId} session=${session.id}, access locked`,
        );
        break;
      }

      case "invoice.upcoming": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);
        if (tenantId) {
          const renewalDate = getInvoicePeriodEnd(invoice) ?? undefined;
          const amount = invoice.amount_due != null
            ? new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: (invoice.currency || "aud").toUpperCase(),
            }).format(invoice.amount_due / 100)
            : undefined;
          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "renewal-reminder",
            { renewalDate, amount },
            `stripe:${event.id}:renewal-reminder`,
          );
          console.log(`[stripe-webhooks] invoice.upcoming handled: tenant=${tenantId} renewal=${renewalDate}`);
        } else {
          console.warn(`[stripe-webhooks] invoice.upcoming: no tenant for customer=${invoice.customer}`);
        }
        break;
      }

      default: {
        console.log(`[stripe-webhooks] Unhandled event type ${event.type} (${event.id}) — acknowledged`);
        break;
      }
    }

    // Only now is the event truly handled — mark it completed so retries skip it.
    const { error: completeError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ status: "completed", completed_at: new Date().toISOString(), last_error: null })
      .eq("id", event.id);
    if (completeError) {
      console.error(`[stripe-webhooks] Failed to mark event ${event.id} completed:`, completeError.message);
      // Ask Stripe to retry: the handler succeeded but the marker did not persist,
      // and every handler above is idempotent (state is mirrored, not incremented).
      return new Response(
        JSON.stringify({ error: "Failed to persist webhook completion" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch (err: any) {
    console.error(`Error processing ${event.type} (${event.id}):`, err);
    // Keep the row for observability but leave it un-completed so Stripe's retry reprocesses it.
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "failed",
        completed_at: null,
        last_error: String(err?.message ?? err).slice(0, 2000),
      })
      .eq("id", event.id);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Webhook handler failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

