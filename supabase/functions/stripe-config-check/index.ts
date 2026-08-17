// Read-only Stripe wiring verification for go-live. Super-admin only.
//
// Confirms that the Stripe credentials and product/price mappings configured in
// THIS environment (dev or production) resolve to real objects in the connected
// Stripe account, that every price is explicitly mapped with no fallback, and
// that the amounts/currency/interval match the published strukcha pricing.
//
// It never prints secret values — only whether they are set, the account mode
// (live vs test), and public object metadata returned by Stripe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { STRIPE_API_VERSION } from "../_shared/stripe-subscription.ts";
import { liveVarName, stripeMode, stripeVar, stripeVarSource } from "../_shared/stripe-env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Published pricing (cents, AUD) — must match src/lib/pricing.ts. */
const EXPECTED = [
  { key: "STRIPE_STARTER_MONTHLY_PRICE_ID", plan: "starter", interval: "month", amount: 9900, productEnv: "STRIPE_STARTER_PRODUCT_ID" },
  { key: "STRIPE_STARTER_ANNUAL_PRICE_ID", plan: "starter", interval: "year", amount: 99000, productEnv: "STRIPE_STARTER_PRODUCT_ID" },
  { key: "STRIPE_PRO_MONTHLY_PRICE_ID", plan: "pro", interval: "month", amount: 24900, productEnv: "STRIPE_PRO_PRODUCT_ID" },
  { key: "STRIPE_PRO_ANNUAL_PRICE_ID", plan: "pro", interval: "year", amount: 249000, productEnv: "STRIPE_PRO_PRODUCT_ID" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: saRow } = await admin
      .from("super_admins").select("id").eq("auth_user_id", caller.id).maybeSingle();
    if (!saRow) return json({ error: "Forbidden" }, 403);

    const issues: string[] = [];

    // Optional read-only mode override (?mode=live) so a super admin can verify
    // the STRIPE_LIVE_* wiring without flipping STRIPE_MODE for the environment.
    const rawOverride = (new URL(req.url).searchParams.get("mode") ?? "").trim().toLowerCase();
    const override = rawOverride === "live" ? "live" : rawOverride === "test" ? "test" : undefined;
    const mode = override ?? stripeMode();
    const sv = (name: string) => stripeVar(name, mode);
    const svs = (name: string) => stripeVarSource(name, mode);

    const stripeKey = sv("STRIPE_SECRET_KEY");
    const webhookSecretSet = Boolean(sv("STRIPE_WEBHOOK_SECRET"));
    if (!webhookSecretSet) issues.push("STRIPE_WEBHOOK_SECRET is not set — webhook signature verification will fail.");
    if (!stripeKey) {
      return json({
        ready: false,
        mode: { configured: mode, stripe_mode_env: Deno.env.get("STRIPE_MODE") ?? null },
        secrets: { stripe_secret_key_set: false, webhook_secret_set: webhookSecretSet },
        issues: [...issues, "STRIPE_SECRET_KEY is not set in this environment."],
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

    // Account + mode. `livemode` on any retrieved object tells us the key's mode.
    const account = await stripe.accounts.retrieve();
    const probe = await stripe.products.list({ limit: 1 });
    const liveMode = probe.data.length > 0
      ? probe.data[0].livemode
      : !(stripeKey.startsWith("sk_test") || stripeKey.startsWith("rk_test"));

    if ((mode === "live") !== liveMode) {
      issues.push(`STRIPE_MODE is "${mode}" but the resolved secret key is a ${liveMode ? "live" : "test"}-mode key.`);
    }

    // ---- Price mapping check: explicit, per plan AND per interval ----
    const prices: Array<Record<string, unknown>> = [];
    for (const exp of EXPECTED) {
      const priceId = sv(exp.key);
      const expectedProduct = sv(exp.productEnv) || null;
      if (!priceId) {
        issues.push(`${exp.key} is not set — ${exp.plan} ${exp.interval}ly checkout cannot run (no fallback exists).`);
        prices.push({ env: exp.key, plan: exp.plan, interval: exp.interval, configured: false, ok: false });
        continue;
      }
      try {
        const price = await stripe.prices.retrieve(priceId);
        const productId = typeof price.product === "string" ? price.product : price.product.id;
        const problems: string[] = [];
        if (price.livemode !== liveMode) problems.push("price belongs to the other Stripe mode");
        if (!price.active) problems.push("price is archived/inactive");
        if (price.currency !== "aud") problems.push(`currency is ${price.currency?.toUpperCase()}, expected AUD`);
        if (price.recurring?.interval !== exp.interval) problems.push(`interval is ${price.recurring?.interval}, expected ${exp.interval}`);
        if (price.unit_amount !== exp.amount) problems.push(`amount is ${price.unit_amount}, expected ${exp.amount}`);
        if (!expectedProduct) problems.push(`${exp.productEnv} is not set — plan cannot be resolved from webhooks`);
        else if (productId !== expectedProduct) {
          problems.push(`price belongs to product ${productId}, which is not ${exp.productEnv}; add it to STRIPE_${exp.plan.toUpperCase()}_LEGACY_PRODUCT_IDS or move the price`);
        }
        problems.forEach((p) => issues.push(`${exp.key}: ${p}`));
        prices.push({
          env: exp.key, plan: exp.plan, interval: exp.interval, configured: true,
          exists: true, livemode: price.livemode, active: price.active,
          currency: price.currency, unit_amount: price.unit_amount,
          recurring_interval: price.recurring?.interval ?? null,
          product_id: productId, ok: problems.length === 0, problems,
        });
      } catch (e: any) {
        issues.push(`${exp.key}: not found in the connected Stripe account (${e?.message ?? "lookup failed"}).`);
        prices.push({ env: exp.key, plan: exp.plan, interval: exp.interval, configured: true, exists: false, ok: false });
      }
    }

    // Duplicate mapping guard: the same price must not serve two plans/intervals.
    const ids = prices.map((p) => sv(String(p.env))).filter(Boolean) as string[];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) issues.push("The same Stripe price ID is mapped to more than one plan/interval.");

    // ---- Products ----
    const products: Array<Record<string, unknown>> = [];
    for (const env of ["STRIPE_STARTER_PRODUCT_ID", "STRIPE_PRO_PRODUCT_ID"]) {
      const id = sv(env);
      if (!id) { issues.push(`${env} is not set — webhooks cannot resolve this plan.`); products.push({ env, configured: false }); continue; }
      try {
        const product = await stripe.products.retrieve(id);
        if (product.livemode !== liveMode) issues.push(`${env}: product belongs to the other Stripe mode.`);
        if (!product.active) issues.push(`${env}: product is archived.`);
        products.push({ env, configured: true, exists: true, name: product.name, active: product.active, livemode: product.livemode });
      } catch (e: any) {
        issues.push(`${env}: not found in the connected Stripe account (${e?.message ?? "lookup failed"}).`);
        products.push({ env, configured: true, exists: false });
      }
    }

    // ---- Webhook endpoints registered on this Stripe account ----
    const expectedUrl = `${supabaseUrl}/functions/v1/stripe-webhooks`;
    const REQUIRED_EVENTS = [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.trial_will_end",
      "invoice.paid",
      "invoice.payment_failed",
    ];
    let webhooks: Array<Record<string, unknown>> = [];
    try {
      const list = await stripe.webhookEndpoints.list({ limit: 20 });
      webhooks = list.data.map((w) => ({
        url: w.url, status: w.status, api_version: w.api_version,
        enabled_events: w.enabled_events,
        matches_this_environment: w.url === expectedUrl,
        missing_events: w.enabled_events.includes("*")
          ? []
          : REQUIRED_EVENTS.filter((e) => !w.enabled_events.includes(e)),
      }));
      const match = webhooks.find((w) => w.matches_this_environment && w.status === "enabled");
      if (!match) {
        issues.push(`No enabled webhook endpoint in this Stripe account points at ${expectedUrl}. Create it in the Stripe Dashboard (matching mode) and save its signing secret as STRIPE_WEBHOOK_SECRET.`);
      } else if ((match.missing_events as string[]).length > 0) {
        issues.push(`Webhook endpoint is missing events: ${(match.missing_events as string[]).join(", ")}.`);
      }
    } catch (e: any) {
      issues.push(`Could not list webhook endpoints: ${e?.message ?? "unknown error"}.`);
    }

    // ---- App-side billing state ----
    const { data: flagRow } = await admin
      .from("app_config").select("value").eq("key", "billing_enforcement_enabled").maybeSingle();

    return json({
      ready: issues.length === 0,
      checked_at: new Date().toISOString(),
      mode: {
        configured: mode,
        stripe_mode_env: Deno.env.get("STRIPE_MODE") ?? null,
        requested_override: override ?? null,
        key_mode: liveMode ? "live" : "test",
        matches_configured_mode: (mode === "live") === liveMode,
        secret_sources: {
          STRIPE_SECRET_KEY: svs("STRIPE_SECRET_KEY"),
          STRIPE_WEBHOOK_SECRET: svs("STRIPE_WEBHOOK_SECRET"),
          STRIPE_STARTER_PRODUCT_ID: svs("STRIPE_STARTER_PRODUCT_ID"),
          STRIPE_PRO_PRODUCT_ID: svs("STRIPE_PRO_PRODUCT_ID"),
          ...Object.fromEntries(EXPECTED.map((e) => [e.key, svs(e.key)])),
        },
        live_var_names: [
          "STRIPE_MODE=live",
          liveVarName("STRIPE_SECRET_KEY"),
          liveVarName("STRIPE_WEBHOOK_SECRET"),
          liveVarName("STRIPE_STARTER_PRODUCT_ID"),
          liveVarName("STRIPE_PRO_PRODUCT_ID"),
          ...EXPECTED.map((e) => liveVarName(e.key)),
        ],
      },
      stripe_account: { id: account.id, name: account.settings?.dashboard?.display_name ?? null, mode: liveMode ? "live" : "test" },
      secrets: { stripe_secret_key_set: true, webhook_secret_set: webhookSecretSet },
      expected_webhook_url: expectedWebhookUrlSafe(expectedUrl),
      billing_enforcement_enabled: flagRow?.value === true,
      trial: { days: 7, group_limit: 3 },
      products,
      prices,
      webhooks,
      issues,
    });
  } catch (error: any) {
    console.error("[stripe-config-check] error:", error?.message);
    return json({ error: error?.message ?? "Check failed" }, 500);
  }
});

/** The functions URL is not secret, but keep it a single derived value. */
function expectedWebhookUrlSafe(url: string): string {
  return url;
}
