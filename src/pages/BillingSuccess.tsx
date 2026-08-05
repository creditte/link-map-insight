import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";

export default function BillingSuccess() {
  const { billing, loading, reload } = useBilling();
  const [waited, setWaited] = useState(false);

  const isConfirmed =
    billing?.subscription_status === "active" || billing?.subscription_status === "trialing";

  // Poll until the Stripe webhook has confirmed the subscription.
  useEffect(() => {
    if (isConfirmed) return;
    const interval = setInterval(() => void reload({ background: true }), 3000);
    const stop = setTimeout(() => {
      setWaited(true);
      clearInterval(interval);
    }, 30_000);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [isConfirmed, reload]);

  const pending = !isConfirmed && !waited;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {loading || pending ? (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">
              Confirming your free trial and finishing your registration…
            </p>
          </>
        ) : isConfirmed ? (
          <>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">You're all set!</h1>
            <p className="mt-3 text-muted-foreground">
              {billing?.subscription_status === "trialing"
                ? `Your 7-day free trial has started. You can build up to ${billing?.diagram_limit ?? 3} client groups.`
                : "Your subscription is active. You're ready to go."}
            </p>
            <Link to="/">
              <Button className="mt-8 w-full h-11 font-semibold">Enter App</Button>
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
            <h1 className="mt-6 text-xl font-semibold text-foreground">
              Still finalising your trial
            </h1>
            <p className="mt-3 text-muted-foreground">
              Stripe is taking a little longer than usual to confirm. This page will keep trying —
              or reload in a moment.
            </p>
            <Button
              variant="outline"
              className="mt-6 w-full h-11"
              onClick={() => {
                setWaited(false);
                void reload({ background: true });
              }}
            >
              Check again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
