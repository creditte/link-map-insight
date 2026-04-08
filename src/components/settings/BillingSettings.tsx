import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Network } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function BillingSettings() {
  const { billing, loading, openPortal } = useBilling();
  const { toast } = useToast();

  const handleManageBilling = async () => {
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-36 mt-2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    trialing: "Free Trial",
    active: "Active",
    past_due: "Past Due",
    canceled: "Cancelled",
    incomplete: "Incomplete",
    trial_expired: "Trial Expired",
  };

  const statusColors: Record<string, string> = {
    trialing: "bg-primary/10 text-primary border-0",
    active: "bg-success/10 text-success border-0",
    past_due: "bg-warning/10 text-warning border-0",
    canceled: "bg-destructive/10 text-destructive border-0",
    trial_expired: "bg-destructive/10 text-destructive border-0",
  };

  const rawStatus = billing?.subscription_status || "free";
  // Show the actual status — don't override trial_expired to active
  const status = rawStatus;
  const label = statusLabels[status] || status;
  const colorClass = statusColors[status] || "bg-muted text-muted-foreground border-0";

  // Derive plan display info
  const planName = billing?.subscription_plan === "starter" ? "strukcha Starter" : "strukcha Pro";
  const isAnnual = billing?.billing_interval === "year";
  
  const priceDisplay = (() => {
    if (billing?.price_amount) {
      const amount = billing.price_amount / 100;
      return isAnnual ? `A$${amount.toLocaleString()}/year` : `A$${amount}/month`;
    }
    // Fallback based on plan
    if (billing?.subscription_plan === "starter") {
      return isAnnual ? "A$990/year" : "A$99/month";
    }
    return isAnnual ? "A$2,490/year" : "A$249/month";
  })();

  const diagramCount = billing?.diagram_count ?? 0;
  const diagramLimit = billing?.diagram_limit ?? 15;

  // Use a future trial end date for display
  const trialEnd = billing?.trial_ends_at
    ? new Date(billing.trial_ends_at)
    : addDays(new Date(), 5);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{planName}</p>
              <p className="text-xs text-muted-foreground">{priceDisplay}</p>
            </div>
            <Badge className={colorClass}>{label}</Badge>
          </div>

          {billing?.subscription_status === "trialing" && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-sm text-primary font-medium">
                Trial ends {format(trialEnd, "d MMM yyyy 'at' h:mm a")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                After your trial, you'll be charged {priceDisplay}.
              </p>
            </div>
          )}

          {billing?.current_period_end && billing.subscription_status === "active" && (
            <p className="text-sm text-muted-foreground">
              Next renewal: {format(new Date(billing.current_period_end), "d MMM yyyy")}
            </p>
          )}

          {billing?.cancel_at_period_end && (
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
              <p className="text-sm text-warning font-medium">Cancellation scheduled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Access continues until {billing.current_period_end ? format(new Date(billing.current_period_end), "d MMM yyyy") : "end of period"}.
              </p>
            </div>
          )}

          <Button onClick={handleManageBilling} className="gap-2">
            <CreditCard className="h-4 w-4" />
            Manage Billing
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active Structures</p>
              <p className="text-xs text-muted-foreground">
                {diagramCount} of {diagramLimit} used
              </p>
            </div>
            <div className="h-2 w-32 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (diagramCount / diagramLimit) * 100)}%`,
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
