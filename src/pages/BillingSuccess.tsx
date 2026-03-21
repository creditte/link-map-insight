import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";

export default function BillingSuccess() {
  const [searchParams] = useSearchParams();
  const { billing, loading, reload } = useBilling();

  // Refresh billing state on mount
  useEffect(() => {
    reload();
    // Poll a few times for webhook to process
    const timers = [
      setTimeout(reload, 3000),
      setTimeout(reload, 8000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reload]);

  const isActive = billing?.subscription_status === "active" || billing?.subscription_status === "trialing";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {loading ? (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Confirming your subscription…</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {isActive ? "You're all set!" : "Payment received"}
            </h1>
            <p className="mt-3 text-muted-foreground">
              {billing?.subscription_status === "trialing"
                ? "Your 7-day free trial has started. Build up to 3 structures during your trial."
                : "Your subscription is active. You're ready to go."}
            </p>
            <Link to="/">
              <Button className="mt-8 w-full h-11 font-semibold">Enter App</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
