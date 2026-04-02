import { useBilling } from "@/hooks/useBilling";
import { CreditCard, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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

  const planLabel = billing.subscription_plan === "pro" ? "Pro" : billing.subscription_plan || "Free";

  // Payment failed — high priority
  if (billing.access_locked_reason === "payment_failed") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-foreground">Payment failed. Update your payment method to restore access.</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={handleManage}>
          Fix Payment
        </Button>
      </div>
    );
  }

  // Cancellation pending
  if (billing.cancel_at_period_end) {
    return (
      <div className="rounded-lg border border-muted bg-muted/30 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Your subscription will end at the end of the current period.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={handleManage}>
          Resubscribe
        </Button>
      </div>
    );
  }

  // Diagram limit reached — only when truly at limit with strict check
  if (
    billing.diagram_limit > 0 &&
    billing.diagram_count >= billing.diagram_limit
  ) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-xs text-foreground">
            You've used {billing.diagram_count} of {billing.diagram_limit} structures on your {planLabel} plan. Upgrade for more.
          </p>
        </div>
        <Button size="sm" className="h-7 gap-1 text-[11px] shrink-0" onClick={handleManage}>
          <CreditCard className="h-3 w-3" />
          Upgrade
        </Button>
      </div>
    );
  }

  // Trial banner — subtle
  if (billing.subscription_status === "trialing") {
    return (
      <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            Free trial — {billing.diagram_count} of {billing.diagram_limit} structures used.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px] shrink-0" onClick={handleManage}>
          <CreditCard className="h-3 w-3" />
          Manage Plan
        </Button>
      </div>
    );
  }

  return null;
}
