import { useBilling } from "@/hooks/useBilling";
import { AlertTriangle, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export default function BillingBanner() {
  const { billing, loading, openPortal } = useBilling();
  const { toast } = useToast();

  if (loading || !billing) return null;

  const handleManage = async () => {
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Trial ending soon (within 2 days)
  if (billing.subscription_status === "trialing" && billing.trial_ends_at) {
    const trialEnd = new Date(billing.trial_ends_at);
    const daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 2 && daysLeft > 0) {
      return (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <p className="text-sm text-foreground">
              Your trial ends {formatDistanceToNow(trialEnd, { addSuffix: true })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleManage} className="gap-1.5 text-xs">
            <CreditCard className="h-3.5 w-3.5" />
            Add Payment
          </Button>
        </div>
      );
    }
  }

  // Payment failed
  if (billing.access_locked_reason === "payment_failed") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-foreground">Payment failed. Update your payment method to restore access.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManage} className="gap-1.5 text-xs">
          Fix Payment
        </Button>
      </div>
    );
  }

  // Cancellation pending
  if (billing.cancel_at_period_end) {
    return (
      <div className="rounded-xl border border-muted bg-muted/30 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Your subscription will end at the end of the current period.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManage} className="gap-1.5 text-xs">
          Resubscribe
        </Button>
      </div>
    );
  }

  // Diagram limit
  if (billing.diagram_count >= billing.diagram_limit) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-3 flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm text-foreground">
          You've reached your {billing.diagram_limit}-structure limit for this workspace.
        </p>
      </div>
    );
  }

  return null;
}
