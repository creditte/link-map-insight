import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Plan configuration mapped by Stripe Product ID
const PLAN_CONFIG: Record<string, { plan: string; diagramLimit: number }> = {};

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
  const productId = subscription.items?.data?.[0]?.price?.product as string;
  if (productId && PLAN_CONFIG[productId]) {
    return PLAN_CONFIG[productId];
  }
  // Fallback to pro if product ID not recognized
  console.warn(`Unknown product ID: ${productId}, defaulting to pro`);
  return { plan: "pro", diagramLimit: 50 };
}

async function findTenantByCustomer(supabaseAdmin: any, customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

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

        // Retrieve the subscription to get product info
        let plan = "pro";
        let diagramLimit = 100;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const resolved = resolvePlanFromSubscription(sub);
          plan = resolved.plan;
          diagramLimit = resolved.diagramLimit;
        }

        await supabaseAdmin
          .from("tenants")
          .update({
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
            trial_used_at: new Date().toISOString(),
            subscription_status: "active",
            subscription_plan: plan,
            access_enabled: true,
            access_locked_reason: null,
            diagram_limit: diagramLimit,
          })
          .eq("id", workspaceId);
        console.log(`Tenant ${workspaceId} checkout completed: plan=${plan}, limit=${diagramLimit}`);
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
          stripe_subscription_id: subscription.id,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000).toISOString()
            : null,
          access_enabled: accessEnabled,
          diagram_limit: accessEnabled ? diagramLimit : 3,
        };

        if (!accessEnabled) {
          updateData.access_locked_reason = status === "canceled" ? "subscription_canceled" : "subscription_" + status;
        } else {
          updateData.access_locked_reason = null;
        }

        if (subscription.trial_end) {
          updateData.trial_ends_at = new Date(subscription.trial_end * 1000).toISOString();
        }

        await supabaseAdmin.from("tenants").update(updateData).eq("id", tenantId);
        console.log(`Updated tenant ${tenantId}: plan=${plan}, status=${status}, limit=${accessEnabled ? diagramLimit : 3}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string);

        if (tenantId) {
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
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);

        if (tenantId) {
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: true,
              access_locked_reason: null,
            })
            .eq("id", tenantId);
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
