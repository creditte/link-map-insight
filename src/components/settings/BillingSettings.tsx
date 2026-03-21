import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Network } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

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
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading billing…
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    trialing: "Free Trial",
    active: "Active",
    past_due: "Past Due",
    canceled: "Cancelled",
    incomplete: "Incomplete",
  };

  const statusColors: Record<string, string> = {
    trialing: "bg-primary/10 text-primary border-0",
    active: "bg-success/10 text-success border-0",
    past_due: "bg-warning/10 text-warning border-0",
    canceled: "bg-destructive/10 text-destructive border-0",
  };

  const status = billing?.subscription_status || "free";
  const label = statusLabels[status] || status;
  const colorClass = statusColors[status] || "bg-muted text-muted-foreground border-0";

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
              <p className="text-sm font-medium">strukcha Pro</p>
              <p className="text-xs text-muted-foreground">A$149/month</p>
            </div>
            <Badge className={colorClass}>{label}</Badge>
          </div>

          {billing?.subscription_status === "trialing" && billing.trial_ends_at && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-sm text-primary font-medium">
                Trial ends {format(new Date(billing.trial_ends_at), "d MMM yyyy")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                After your trial, you'll be charged A$149/month.
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

          <Button onClick={handleManageBilling} variant="outline" className="gap-2">
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
                {billing?.diagram_count ?? 0} of {billing?.diagram_limit ?? 3} used
              </p>
            </div>
            <div className="h-2 w-32 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${Math.min(100, ((billing?.diagram_count ?? 0) / (billing?.diagram_limit ?? 3)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
