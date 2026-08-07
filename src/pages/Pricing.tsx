import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ANNUAL_SAVING_LABEL,
  PLANS,
  SALES_EMAIL,
  TRIAL,
  priceLabel,
  type BillingInterval,
} from "@/lib/pricing";

const ORDER = ["starter", "pro", "enterprise"] as const;

export default function Pricing() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  return (
    <div className="min-h-screen bg-background px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <header className="text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Simple pricing for advisory firms
          </h1>
          <p className="mx-auto mt-3 max-w-xl font-body text-muted-foreground">
            Start with a {TRIAL.days}-day trial that includes full Pro features. You can create up to{" "}
            {TRIAL.groupLimit} structure groups during your trial.
          </p>

          <div
            role="group"
            aria-label="Billing interval"
            className="mx-auto mt-8 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1"
          >
            {(["monthly", "annual"] as BillingInterval[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  interval === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "monthly" ? "Monthly" : "Annual"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs font-medium text-primary">{ANNUAL_SAVING_LABEL} with annual billing</p>
        </header>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {ORDER.map((id) => {
            const plan = PLANS[id];
            const isEnterprise = plan.checkout === "contact_sales";
            return (
              <Card
                key={plan.id}
                className={plan.highlight ? "border-primary/50 shadow-lg" : "border-border/60"}
              >
                <CardContent className="flex h-full flex-col p-6">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-heading text-lg font-semibold text-foreground">{plan.name}</h2>
                    {plan.highlight && <Badge className="border-0 bg-primary/10 text-primary">Most popular</Badge>}
                  </div>
                  <p className="mt-1 font-body text-sm text-muted-foreground">{plan.tagline}</p>

                  <p className="mt-5 font-heading text-2xl font-bold text-foreground">
                    {priceLabel(plan, interval)}
                  </p>
                  {isEnterprise ? (
                    <p className="mt-1 text-xs text-muted-foreground">Annual agreement, priced on scope</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {interval === "annual" ? ANNUAL_SAVING_LABEL : "Billed monthly, cancel any time"}
                    </p>
                  )}

                  <ul className="mt-6 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 font-body text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 pt-2">
                    {isEnterprise ? (
                      <Button asChild variant="outline" className="h-11 w-full font-semibold">
                        <a href={`mailto:${SALES_EMAIL}?subject=strukcha%20Enterprise%20enquiry`}>
                          Contact sales
                        </a>
                      </Button>
                    ) : (
                      <Button asChild className="h-11 w-full font-semibold">
                        <Link to={`/signup?plan=${plan.id}&billing=${interval}`}>
                          Start {TRIAL.days}-day trial
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="mt-10 text-center font-body text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
