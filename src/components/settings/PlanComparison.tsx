import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ArrowUpCircle, ArrowDownCircle, Mail, Clock, Layers } from "lucide-react";
import { PLANS, SALES_EMAIL, priceLabel, type BillingInterval } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface PlanComparisonProps {
  /** Plan Stripe currently bills, or null when unknown. */
  currentPlan: string | null;
  /** Plan that will apply at the next renewal (pending downgrade target). */
  scheduledPlan: string | null;
  interval: BillingInterval;
  canSwitch: boolean;
  disabledReason: string | null;
  onSelectPlan: (plan: "starter" | "pro") => void;
}

const ORDER: Array<"starter" | "pro" | "enterprise"> = ["starter", "pro", "enterprise"];
const RANK: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 };

export default function PlanComparison({
  currentPlan,
  scheduledPlan,
  interval,
  canSwitch,
  disabledReason,
  onSelectPlan,
}: PlanComparisonProps) {
  const currentRank = currentPlan ? RANK[currentPlan] ?? 0 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Plans
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Upgrades apply immediately. Downgrades apply at the end of your current billing period.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canSwitch && disabledReason && (
          <div className="flex items-start gap-2 rounded-lg border px-4 py-3">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{disabledReason}</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {ORDER.map((id) => {
            const plan = PLANS[id];
            const isCurrent = currentPlan === id;
            const isScheduled = !isCurrent && scheduledPlan === id;
            const rank = RANK[id];
            const isUpgrade = rank > currentRank;
            const isEnterprise = plan.checkout === "contact_sales";

            return (
              <div
                key={id}
                className={cn(
                  "flex flex-col rounded-lg border p-4",
                  isCurrent && "border-primary bg-primary/5",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">strukcha {plan.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {priceLabel(plan, interval)}
                    </p>
                  </div>
                  {isCurrent && <Badge className="border-0 bg-primary/10 text-primary">Current</Badge>}
                  {isScheduled && (
                    <Badge className="border-0 bg-warning/10 text-warning">Scheduled</Badge>
                  )}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">{plan.tagline}</p>

                <ul className="mt-3 space-y-1.5 flex-1">
                  {plan.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-px" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {isEnterprise ? (
                    <Button asChild variant="outline" size="sm" className="w-full gap-2">
                      <a
                        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
                          "strukcha Enterprise enquiry",
                        )}`}
                      >
                        <Mail className="h-4 w-4" />
                        Contact sales
                      </a>
                    </Button>
                  ) : isCurrent && !scheduledPlan ? (
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      Your plan
                    </Button>
                  ) : (
                    <Button
                      variant={isUpgrade ? "default" : "outline"}
                      size="sm"
                      className="w-full gap-2"
                      disabled={!canSwitch}
                      onClick={() => onSelectPlan(id as "starter" | "pro")}
                    >
                      {isUpgrade ? (
                        <ArrowUpCircle className="h-4 w-4" />
                      ) : (
                        <ArrowDownCircle className="h-4 w-4" />
                      )}
                      {isCurrent
                        ? `Keep ${plan.name}`
                        : isUpgrade
                          ? `Upgrade to ${plan.name}`
                          : `Downgrade to ${plan.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
