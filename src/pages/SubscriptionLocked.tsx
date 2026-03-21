import { Button } from "@/components/ui/button";
import { Lock, AlertTriangle, CreditCard } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";

const REASON_MESSAGES: Record<string, { title: string; description: string }> = {
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
  const { billing, openPortal } = useBilling();
  const { toast } = useToast();

  const reason = billing?.access_locked_reason || "default";
  const msg = REASON_MESSAGES[reason] || REASON_MESSAGES.default;

  const handleManageBilling = async () => {
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          {reason === "payment_failed" ? (
            <CreditCard className="h-8 w-8 text-destructive" />
          ) : (
            <Lock className="h-8 w-8 text-destructive" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{msg.title}</h1>
          <p className="text-muted-foreground">{msg.description}</p>
        </div>

        <Button onClick={handleManageBilling} className="w-full h-11 font-semibold gap-2">
          <CreditCard className="h-4 w-4" />
          Manage Billing
        </Button>

        <p className="text-xs text-muted-foreground">
          Need help? Contact support at support@strukcha.app
        </p>
      </div>
    </div>
  );
}
