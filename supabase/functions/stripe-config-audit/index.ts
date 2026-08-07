// Temporary read-only diagnostic: reports which Stripe product/price IDs the
// backend env mapping resolves to. Never returns secret keys.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const body = {
    mode: key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") ? "test" : "unknown",
    starter_product: Deno.env.get("STRIPE_STARTER_PRODUCT_ID") ?? null,
    starter_monthly_price: Deno.env.get("STRIPE_STARTER_MONTHLY_PRICE_ID") ?? null,
    starter_annual_price: Deno.env.get("STRIPE_STARTER_ANNUAL_PRICE_ID") ?? null,
    pro_product: Deno.env.get("STRIPE_PRO_PRODUCT_ID") ?? null,
    pro_monthly_price: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") ?? null,
    pro_annual_price: Deno.env.get("STRIPE_PRO_ANNUAL_PRICE_ID") ?? null,
    starter_legacy_products: Deno.env.get("STRIPE_STARTER_LEGACY_PRODUCT_IDS") ?? null,
    pro_legacy_products: Deno.env.get("STRIPE_PRO_LEGACY_PRODUCT_IDS") ?? null,
    legacy_prices: Deno.env.get("STRIPE_LEGACY_PRICE_IDS") ?? null,
  };

  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
