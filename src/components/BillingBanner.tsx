import { useBilling } from "@/hooks/useBilling";
import { CreditCard, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTenantUsers } from "@/hooks/useTenantUsers";

export default function BillingBanner() {
  const { billing, loading, openPortal } = useBilling();
  const { currentUser } = useTenantUsers();
  const { toast } = useToast();

  const canManageBilling = currentUser?.role === "owner" || (currentUser?.role === "admin" && currentUser?.can_manage_billing);

  if (loading || !billing) return null;

  // Central kill-switch: hide all billing banners while enforcement is disabled.
  if (billing.enforcement_enabled === false) return null;

  // Only owners and admins with billing access can see billing actions
  if (!canManageBilling) return null;

  const handleManage = async () => {
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Trial banner
  if (billing.subscription_status === "trialing") {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            You're on the free trial — upgrade to unlock unlimited structures.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={handleManage} className="gap-1.5 text-xs shrink-0 h-7">
          <CreditCard className="h-3 w-3" />
          Manage Plan
        </Button>
      </div>
    );
  }

  // Payment failed
  if (billing.access_locked_reason === "payment_failed") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CreditCard className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-foreground">Payment failed. Update your payment method to restore access.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManage} className="gap-1.5 text-xs h-7">
          Fix Payment
        </Button>
      </div>
    );
  }

  // Cancellation pending
  if (billing.cancel_at_period_end) {
    return (
      <div className="rounded-lg border border-muted bg-muted/30 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Your subscription will end at the end of the current period.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManage} className="gap-1.5 text-xs h-7">
          Resubscribe
        </Button>
      </div>
    );
  }

  // Diagram limit reached — only show when genuinely at the limit
  if (billing.diagram_limit > 0 && billing.diagram_count >= billing.diagram_limit) {
    const planLabel = billing.subscription_plan === "pro" ? "Pro" : billing.subscription_plan === "free" ? "Free" : (billing.subscription_plan || "current");

    return (
      <div className="rounded-lg border border-muted bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            You've used {billing.diagram_count} of {billing.diagram_limit} structures on your {planLabel} plan. Upgrade for more.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleManage} className="gap-1.5 text-xs shrink-0 h-7">
          <CreditCard className="h-3 w-3" />
          Manage Plan
        </Button>
      </div>
    );
  }

  return null;
}
