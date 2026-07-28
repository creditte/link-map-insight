import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { invokeTransactionalEmail } from "../_shared/invoke-transactional-email.ts";
import { getTenantBillingRecipients } from "../_shared/tenant-recipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Plan configuration mapped by Stripe Product ID
const PLAN_CONFIG: Record<string, { plan: string; diagramLimit: number }> = {};

const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    month: Deno.env.get("STRIPE_STARTER_MONTHLY_PRICE_ID"),
    year: Deno.env.get("STRIPE_STARTER_ANNUAL_PRICE_ID"),
  },
  pro: {
    month: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
    year: Deno.env.get("STRIPE_PRO_ANNUAL_PRICE_ID"),
  },
};

function initPlanConfig() {
  const starterProductId = Deno.env.get("STRIPE_STARTER_PRODUCT_ID");
  const proProductId = Deno.env.get("STRIPE_PRO_PRODUCT_ID");

  if (starterProductId) {
    PLAN_CONFIG[starterProductId] = { plan: "starter", diagramLimit: 15 };
  }
  if (proProductId) {
    PLAN_CONFIG[proProductId] = { plan: "pro", diagramLimit: 50 };
  }
}

function resolvePlanFromSubscription(subscription: Stripe.Subscription): { plan: string; diagramLimit: number } {
  const productId = subscription.items?.data?.[0]?.price?.product as string | undefined;
  const priceId = subscription.items?.data?.[0]?.price?.id as string | undefined;
  if (!productId || !PLAN_CONFIG[productId]) {
    const configuredProducts = Object.keys(PLAN_CONFIG);
    console.error(
      `[stripe-webhooks] Unknown Stripe product mapping. subscription_id=${subscription.id} product_id=${productId} price_id=${priceId} configured_products=${JSON.stringify(configuredProducts)}`,
    );
    throw new Error(
      `Unmapped Stripe product ID "${productId}". Configure STRIPE_STARTER_PRODUCT_ID / STRIPE_PRO_PRODUCT_ID to match this product before activating the subscription.`,
    );
  }
  // Validate that the price on the subscription is one of the configured price IDs
  const knownPriceIds = new Set(
    Object.values(PRICE_MAP).flatMap((m) => Object.values(m)).filter(Boolean) as string[],
  );
  if (priceId && knownPriceIds.size > 0 && !knownPriceIds.has(priceId)) {
    console.error(
      `[stripe-webhooks] Unknown Stripe price ID on subscription ${subscription.id}: price_id=${priceId} known_prices=${JSON.stringify([...knownPriceIds])}`,
    );
    throw new Error(
      `Unmapped Stripe price ID "${priceId}". Configure STRIPE_*_PRICE_ID env vars to match this price before activating the subscription.`,
    );
  }
  return PLAN_CONFIG[productId];
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

const toISO = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === "number") return new Date(val * 1000).toISOString();
  if (typeof val === "string") return new Date(val).toISOString();
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Server misconfigured", { status: 500 });
  }

  initPlanConfig();

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
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

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existing) {
    console.log(`Event ${event.id} already processed, skipping`);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // Record event
  await supabaseAdmin.from("stripe_webhook_events").insert({
    id: event.id,
    event_type: event.type,
    payload: event.data.object as any,
  });

  console.log(`Processing webhook: ${event.type} (${event.id})`);

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
        const periodStart = toISO(sub.current_period_start);
        const periodEnd = toISO(sub.current_period_end);

        await supabaseAdmin
          .from("tenants")
          .update({
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
            trial_used_at: new Date().toISOString(),
            subscription_status: "active",
            subscription_plan: plan,
            selected_plan: plan,
            access_enabled: true,
            access_locked_reason: null,
            diagram_limit: diagramLimit,
            current_period_start: periodStart,
            current_period_end: periodEnd,
          })
          .eq("id", workspaceId);
        console.log(`Tenant ${workspaceId} checkout completed: plan=${plan}, limit=${diagramLimit}, period_end=${periodEnd}`);
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
        const status = subscription.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          subscription_status: status,
          subscription_plan: plan,
          selected_plan: plan, // Sync selected_plan to actual plan on Stripe changes
          stripe_subscription_id: subscription.id,
          current_period_start: toISO(subscription.current_period_start),
          current_period_end: toISO(subscription.current_period_end),
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at
            ? toISO(subscription.canceled_at)
            : null,
          access_enabled: accessEnabled,
          access_locked_reason: accessEnabled ? null : (status === "canceled" ? "subscription_canceled" : `subscription_${status}`),
          diagram_limit: diagramLimit,
        };

        if (subscription.trial_end) {
          updateData.trial_ends_at = new Date(subscription.trial_end * 1000).toISOString();
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
              canceled_at: new Date().toISOString(),
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
                  await stripe.subscriptions.update(tenant.stripe_subscription_id, {
                    items: [{ id: currentItem.id, price: targetPriceId }],
                    proration_behavior: "none",
                  });

                  const newLimit = tenant.selected_plan === "starter" ? 15 : 50;
                  await supabaseAdmin.from("tenants").update({
                    subscription_plan: tenant.selected_plan,
                    diagram_limit: newLimit,
                  }).eq("id", tenantId);

                  console.log(`Tenant ${tenantId}: deferred plan change applied to ${tenant.selected_plan}`);
                } else {
                  console.error(`No price ID for plan=${tenant.selected_plan}, interval=${currentInterval}`);
                }
              }
            } catch (e: any) {
              console.error(`Failed to apply deferred plan change for tenant ${tenantId}:`, e.message);
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
        if (tenantId && subscription.trial_end) {
          const trialEndIso = new Date(subscription.trial_end * 1000).toISOString();
          const daysRemaining = Math.max(
            1,
            Math.ceil((subscription.trial_end * 1000 - Date.now()) / (24 * 60 * 60 * 1000)),
          );
          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "trial-ending",
            { trialEndsAt: trialEndIso, daysRemaining },
            `stripe:${event.id}:trial-ending`,
          );
        }
        break;
      }

      case "invoice.upcoming": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);
        if (tenantId) {
          const renewalDate = invoice.period_end
            ? new Date(invoice.period_end * 1000).toISOString()
            : undefined;
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
        }
        break;
      }
    }
  } catch (err: any) {
    console.error(`Error processing ${event.type}:`, err);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
