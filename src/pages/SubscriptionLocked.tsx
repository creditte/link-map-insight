import { Button } from "@/components/ui/button";
import { Lock, AlertTriangle, CreditCard, Clock } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const REASON_MESSAGES: Record<string, { title: string; description: string }> = {
  trial_expired: {
    title: "Your Free Trial Has Ended",
    description: "Your 7-day trial has expired. Subscribe to strukcha Pro to continue using your workspace.",
  },
  payment_failed: {
    title: "Payment Failed",
    description: "Your last payment didn't go through. Update your payment method to restore access.",
  },
  subscription_canceled: {
    title: "Subscription Cancelled",
    description: "Your subscription has ended. Resubscribe to regain access to your workspace.",
  },
  default: {
    title: "Subscription Inactive",
    description: "Your workspace subscription is inactive. Please update your billing to restore access.",
  },
};

export default function SubscriptionLocked() {
  const { billing, openPortal, startCheckout } = useBilling();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const reason = billing?.access_locked_reason || "default";
  const msg = REASON_MESSAGES[reason] || REASON_MESSAGES.default;
  const isTrialExpired = reason === "trial_expired";

  const handleAction = async () => {
    setLoading(true);
    try {
      if (isTrialExpired) {
        await startCheckout();
      } else {
        await openPortal();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          {isTrialExpired ? (
            <Clock className="h-8 w-8 text-primary" />
          ) : reason === "payment_failed" ? (
            <CreditCard className="h-8 w-8 text-destructive" />
          ) : (
            <Lock className="h-8 w-8 text-destructive" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{msg.title}</h1>
          <p className="text-muted-foreground">{msg.description}</p>
        </div>

        {isTrialExpired && billing && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-left">
            <p className="text-sm font-medium text-foreground">
              {billing.subscription_plan === "starter" ? "strukcha Starter" : "strukcha Pro"} — {
                billing.subscription_plan === "starter"
                  ? (billing.billing_interval === "year" ? "A$990/year" : "A$99/month")
                  : (billing.billing_interval === "year" ? "A$2,490/year" : "A$249/month")
              }
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Up to {billing.subscription_plan === "starter" ? "15" : "50"} client groups, full access to all features.
            </p>
          </div>
        )}

        <Button onClick={handleAction} disabled={loading} className="w-full h-11 font-semibold gap-2">
          <CreditCard className="h-4 w-4" />
          {isTrialExpired ? "Subscribe Now" : "Manage Billing"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Need help? Contact support at support@strukcha.app
        </p>
      </div>
    </div>
  );
}
