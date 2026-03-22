import { useBilling } from "@/hooks/useBilling";
import { CreditCard, Sparkles, AlertTriangle } from "lucide-react";
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

  // Trial banner — encouraging upgrade prompt
  if (billing.subscription_status === "trialing") {
    return (
      <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/8 to-primary/5 px-5 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <p className="text-sm text-foreground">
            You're on the free trial — upgrade to unlock unlimited structures.
          </p>
        </div>
        <Button size="sm" onClick={handleManage} className="gap-1.5 text-xs shrink-0">
          <CreditCard className="h-3.5 w-3.5" />
          Manage Plan
        </Button>
      </div>
    );
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

  // Diagram limit — encouraging
  if (billing.diagram_count >= billing.diagram_limit) {
    return (
      <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/8 to-primary/5 px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Structure limit reached
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              You've used all {billing.diagram_limit} structures. Upgrade or archive existing structures to continue.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={handleManage} className="gap-1.5 text-xs shrink-0">
          <CreditCard className="h-3.5 w-3.5" />
          Manage Plan
        </Button>
      </div>
    );
  }

  return null;
}
