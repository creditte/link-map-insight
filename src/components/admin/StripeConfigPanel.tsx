import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";

interface PriceRow {
  env: string;
  plan: string;
  interval: string;
  configured: boolean;
  exists?: boolean;
  livemode?: boolean;
  active?: boolean;
  currency?: string;
  unit_amount?: number;
  recurring_interval?: string | null;
  product_id?: string;
  ok?: boolean;
  problems?: string[];
}

interface ConfigCheck {
  ready: boolean;
  checked_at: string;
  stripe_account?: { id: string; name: string | null; mode: string };
  mode?: {
    configured: string;
    stripe_mode_env: string | null;
    key_mode?: string;
    matches_configured_mode?: boolean;
    secret_sources?: Record<string, string | null>;
    live_var_names?: string[];
  };
  secrets?: { stripe_secret_key_set: boolean; webhook_secret_set: boolean };
  expected_webhook_url?: string;
  billing_enforcement_enabled?: boolean;
  products?: Array<Record<string, unknown>>;
  prices?: PriceRow[];
  webhooks?: Array<{ url: string; status: string; matches_this_environment: boolean; missing_events: string[] }>;
  issues: string[];
}

const money = (cents?: number) =>
  typeof cents === "number" ? `A$${(cents / 100).toLocaleString("en-AU")}` : "—";

export default function StripeConfigPanel() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConfigCheck | null>(null);

  const run = async (modeOverride?: "live" | "test") => {
    setRunning(true);
    try {
      const path = modeOverride ? `stripe-config-check?mode=${modeOverride}` : "stripe-config-check";
      const { data, error } = await supabase.functions.invoke(path);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as ConfigCheck);
      toast({
        title: (data as ConfigCheck).ready ? "Stripe configuration verified" : "Stripe configuration incomplete",
        description: (data as ConfigCheck).ready
          ? "All products, prices and the webhook endpoint resolve correctly."
          : `${(data as ConfigCheck).issues.length} issue(s) need attention.`,
        variant: (data as ConfigCheck).ready ? "default" : "destructive",
      });
    } catch (e: any) {
      const detail = e?.context?.body || e?.message || "Check failed";
      toast({ title: "Stripe check failed", description: String(detail), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CreditCard className="h-4 w-4 text-primary" /> Stripe configuration check
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Verifies this environment's Stripe mode, plan/price mappings and webhook endpoint.
              Read-only — no charges, no changes in Stripe.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run()} disabled={running} size="sm" className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Run check
            </Button>
            <Button onClick={() => run("live")} disabled={running} size="sm" variant="outline" className="gap-2">
              Verify live wiring
            </Button>
          </div>
        </div>


        {result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.stripe_account?.mode === "live" ? "default" : "secondary"}>
                {result.stripe_account?.mode === "live" ? "Live mode" : "Test mode"}
              </Badge>
              <Badge variant={result.mode?.matches_configured_mode === false ? "destructive" : "outline"}>
                STRIPE_MODE: {result.mode?.stripe_mode_env ?? "unset (test)"}
              </Badge>
              <Badge variant="outline">{result.stripe_account?.name || result.stripe_account?.id}</Badge>
              <Badge variant={result.secrets?.webhook_secret_set ? "outline" : "destructive"}>
                Webhook secret {result.secrets?.webhook_secret_set ? "set" : "missing"}
              </Badge>
              <Badge variant={result.billing_enforcement_enabled ? "outline" : "secondary"}>
                Enforcement {result.billing_enforcement_enabled ? "on" : "off"}
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Mapping</th>
                    <th className="py-2 text-left font-medium">Plan</th>
                    <th className="py-2 text-left font-medium">Interval</th>
                    <th className="py-2 text-left font-medium">Amount</th>
                    <th className="py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.prices?.map((p) => (
                    <tr key={p.env} className="border-b last:border-0">
                      <td className="py-2 font-mono">{p.env}</td>
                      <td className="py-2 capitalize">{p.plan}</td>
                      <td className="py-2">{p.recurring_interval ?? p.interval}</td>
                      <td className="py-2">{money(p.unit_amount)} {p.currency?.toUpperCase()}</td>
                      <td className="py-2">
                        {p.ok ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {p.configured ? (p.exists === false ? "Not found" : "Mismatch") : "Not configured"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.webhooks && result.webhooks.length > 0 && (
              <div className="space-y-1 text-xs">
                <p className="font-medium text-foreground">Webhook endpoints in this Stripe account</p>
                {result.webhooks.map((w) => (
                  <p key={w.url} className="text-muted-foreground">
                    {w.matches_this_environment ? "✓" : "•"} {w.url} — {w.status}
                    {w.missing_events?.length ? ` (missing: ${w.missing_events.join(", ")})` : ""}
                  </p>
                ))}
              </div>
            )}

            {result.issues.length > 0 ? (
              <div className="space-y-1 rounded-md bg-destructive/10 p-3 text-xs">
                <p className="font-medium text-destructive">Requires manual configuration</p>
                {result.issues.map((i, idx) => (
                  <p key={idx} className="text-destructive">• {i}</p>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-xs text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> This environment is correctly wired to Stripe.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
