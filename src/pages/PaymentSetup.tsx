import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, ShieldCheck, Lock } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const PLAN_COPY: Record<string, { name: string; monthly: string; annual: string; groups: string }> = {
  starter: { name: "strukcha Starter", monthly: "A$99/month", annual: "A$990/year", groups: "15" },
  pro: { name: "strukcha Pro", monthly: "A$249/month", annual: "A$2,490/year", groups: "50" },
};

export default function PaymentSetup() {
  const { billing, loading, startCheckout, reload } = useBilling();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "cancelled") {
      toast({
        title: "Payment setup not completed",
        description: "A payment method is required before your free trial can start.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  // Once the card is attached, the gate lifts — send them into the app.
  useEffect(() => {
    if (!loading && billing && billing.payment_method_required === false) {
      navigate("/", { replace: true });
    }
  }, [loading, billing, navigate]);

  const planKey = billing?.selected_plan === "starter" ? "starter" : "pro";
  const plan = PLAN_COPY[planKey];
  const isAnnual = billing?.billing_interval === "year";

  const handleStart = async () => {
    setSubmitting(true);
    try {
      await startCheckout();
    } catch (err: any) {
      if (String(err?.message || "").includes("already has a subscription")) {
        await reload({ background: true });
        navigate("/", { replace: true });
        return;
      }
      toast({ title: "Could not open payment page", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Final step — start your free trial
          </h1>
          <p className="text-muted-foreground">
            Your registration completes once your 7-day free trial starts. Your card is securely
            stored by Stripe and{" "}
            <span className="font-medium text-foreground">won't be charged today</span>.
          </p>
        </div>


        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-left">
          <p className="text-sm font-medium text-foreground">
            {plan.name} — {isAnnual ? plan.annual : plan.monthly} after the trial
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Up to {plan.groups} client groups, full access during the trial. Cancel any time before
            day 7 and you won't be charged.
          </p>
        </div>

        <Button
          onClick={handleStart}
          disabled={submitting || loading}
          className="w-full h-11 gap-2 font-semibold"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening secure checkout…
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4" /> Add payment method & start trial
            </>
          )}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Card details are handled entirely by Stripe — we
          never see or store them.
        </p>

        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Lock className="h-3 w-3" /> Sign out
        </button>
      </div>
    </div>
  );
}
