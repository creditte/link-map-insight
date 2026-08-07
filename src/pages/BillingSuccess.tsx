import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Users, Workflow } from "lucide-react";
import XeroLogo from "@/components/XeroLogo";
import XeroOrgPickerDialog from "@/components/XeroOrgPickerDialog";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { xeroToastPayload } from "@/lib/xeroErrors";
import { TRIAL, planDisplayName, renewalLabel } from "@/lib/pricing";

const INDIGO = "#4F46E5";
const EMERALD = "#10B981";

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface StepShellProps {
  index: number;
  title: string;
  description: string;
  complete: boolean;
  enabled: boolean;
  icon: React.ReactNode;
  children?: React.ReactNode;
}

function Step({ index, title, description, complete, enabled, icon, children }: StepShellProps) {
  return (
    <li
      className={`flex gap-4 rounded-xl border p-4 sm:p-5 ${
        enabled ? "border-border bg-card" : "border-border/60 bg-muted/30"
      }`}
      aria-disabled={!enabled}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={
          complete
            ? { backgroundColor: `${EMERALD}1A`, color: EMERALD }
            : enabled
              ? { backgroundColor: `${INDIGO}1A`, color: INDIGO }
              : undefined
        }
      >
        {complete ? <Check className="h-4 w-4" aria-label="Completed" /> : <span>{index}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={enabled ? "text-muted-foreground" : "text-muted-foreground/60"}>{icon}</span>
          <h2
            className={`font-heading text-sm font-semibold sm:text-base ${
              enabled ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {title}
          </h2>
        </div>
        <p
          className={`mt-1 font-body text-xs sm:text-sm ${
            enabled ? "text-muted-foreground" : "text-muted-foreground/70"
          }`}
        >
          {description}
        </p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

export default function BillingSuccess() {
  const { billing, loading, reload } = useBilling();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState<string>("");
  const [xeroConnected, setXeroConnected] = useState(false);
  const [structureCount, setStructureCount] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [waited, setWaited] = useState(false);

  const isConfirmed =
    billing?.subscription_status === "active" || billing?.subscription_status === "trialing";

  // Poll until the Stripe webhook has confirmed the subscription.
  useEffect(() => {
    if (isConfirmed) return;
    const interval = window.setInterval(() => void reload({ background: true }), 3000);
    const stop = window.setTimeout(() => {
      setWaited(true);
      window.clearInterval(interval);
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [isConfirmed, reload]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const name =
        (data.user?.user_metadata?.full_name as string | undefined) ||
        (data.user?.email ? data.user.email.split("@")[0] : "");
      setFirstName((name || "").trim().split(/\s+/)[0] || "");
    })();
  }, []);

  const refreshActivationState = useCallback(async () => {
    const [{ data: connection }, { count }] = await Promise.all([
      supabase.rpc("get_xero_connection_info"),
      supabase
        .from("structures")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
    ]);
    setXeroConnected(Boolean(connection && connection !== "null"));
    setStructureCount(count ?? 0);
  }, []);

  useEffect(() => {
    void refreshActivationState();
    const poll = window.setInterval(() => void refreshActivationState(), 8000);
    return () => window.clearInterval(poll);
  }, [refreshActivationState]);

  const handleConnectXpm = async () => {
    setConnecting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        // Return to this activation screen after Xero completes.
        body: JSON.stringify({
          origin: `${window.location.origin}/billing/success`,
          connection_type: "practice_manager",
        }),
      });
      let data: any = null;
      try {
        data = JSON.parse(await res.text());
      } catch {
        // handled below
      }
      const oauthUrl = data?.auth_url || data?.url;
      if (!res.ok || !oauthUrl) throw new Error(data?.error || "Couldn't start Xero sign-in.");
      window.location.href = oauthUrl;
    } catch (err) {
      const payload = xeroToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
      setConnecting(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-demo-group");
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await refreshActivationState();
      const id = (data as { structure_id?: string })?.structure_id;
      navigate(id ? `/structures/${id}` : "/structures");
    } catch (err: any) {
      toast({
        title: "Couldn't load the demo group",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingDemo(false);
    }
  };

  const billingBlock = useMemo(() => {
    if (!billing) return null;
    const plan = planDisplayName(billing.subscription_plan || billing.selected_plan);
    const renewal = renewalLabel(
      billing.subscription_plan || billing.selected_plan,
      billing.billing_interval,
      billing.price_amount,
    );
    const trialEnd = formatDate(billing.trial_ends_at);
    const periodEnd = formatDate(billing.current_period_end);

    if (billing.subscription_status === "trialing") {
      const daysLeft = billing.trial_ends_at
        ? Math.max(
            0,
            Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000),
          )
        : null;
      return (
        <>
          Your {plan} trial ends on {trialEnd ?? "your trial end date"}
          {daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining)` : ""}. After
          the trial, your subscription renews at {renewal}. You can create up to {TRIAL.groupLimit}{" "}
          structure groups during your trial. Cancel any time from Settings → Billing.
        </>
      );
    }
    return (
      <>
        Your {plan} subscription is active and renews at {renewal}
        {periodEnd ? ` on ${periodEnd}` : ""}. You can manage or cancel your subscription from
        Settings → Billing at any time.
      </>
    );
  }, [billing]);

  if (loading || (!isConfirmed && !waited)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 font-body text-muted-foreground">
            Confirming your subscription and finishing your registration…
          </p>
        </div>
      </div>
    );
  }

  if (!isConfirmed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Still finalising your subscription
          </h1>
          <p className="mt-3 font-body text-muted-foreground">
            Stripe is taking a little longer than usual to confirm. This page will keep trying — or
            reload in a moment.
          </p>
          <Button
            variant="outline"
            className="mt-6 h-11 w-full"
            onClick={() => {
              setWaited(false);
              void reload({ background: true });
            }}
          >
            Check again
          </Button>
        </div>
      </div>
    );
  }

  const step2Complete = xeroConnected && structureCount > 0;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10 sm:px-6 sm:py-14">
      <XeroOrgPickerDialog onConnected={() => void refreshActivationState()} />

      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-2 font-body text-muted-foreground">
          Connect Xero Practice Manager and we'll build your first client structure diagram for you —
          no manual data entry.
        </p>

        <ol className="mt-8 space-y-3">
          <Step
            index={1}
            title="Connect Xero Practice Manager"
            description={
              xeroConnected
                ? "Connected. We're pulling your client groups into strukcha."
                : "Authorise strukcha to read your XPM client list. Takes about 30 seconds."
            }
            complete={xeroConnected}
            enabled
            icon={<XeroLogo className="h-4 w-4" />}
          >
            {xeroConnected ? (
              <p className="font-body text-xs font-medium" style={{ color: EMERALD }}>
                Xero Practice Manager connected
              </p>
            ) : (
              <Button
                onClick={handleConnectXpm}
                disabled={connecting}
                className="h-11 w-full gap-2 font-semibold text-white hover:opacity-90 sm:w-auto"
                style={{ backgroundColor: INDIGO }}
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Redirecting to Xero…
                  </>
                ) : (
                  "Connect Xero Practice Manager"
                )}
              </Button>
            )}
          </Step>

          <Step
            index={2}
            title="Review your first structure group"
            description="Open the structure we generate from XPM and confirm the relationships look right."
            complete={step2Complete}
            enabled={xeroConnected}
            icon={<Workflow className="h-4 w-4" />}
          >
            {xeroConnected && (
              <Button asChild variant="outline" className="h-10 w-full sm:w-auto">
                <Link to="/structures">Open structures</Link>
              </Button>
            )}
          </Step>

          <Step
            index={3}
            title="Invite your team"
            description="Add the advisors in your firm so everyone works from the same structures."
            complete={false}
            enabled={step2Complete}
            icon={<Users className="h-4 w-4" />}
          >
            {step2Complete && (
              <Button asChild variant="outline" className="h-10 w-full sm:w-auto">
                <Link to="/settings?tab=users">Invite your team</Link>
              </Button>
            )}
          </Step>
        </ol>

        <p className="mt-5 text-center font-body text-sm text-muted-foreground sm:text-left">
          Just exploring?{" "}
          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={loadingDemo}
            className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60"
          >
            {loadingDemo ? "Loading demo…" : "Load the Rogan family demo group"}
          </button>
        </p>

        {billingBlock && (
          <div className="mt-8 rounded-lg border border-border/60 bg-background px-4 py-3">
            <p className="font-body text-xs leading-relaxed text-muted-foreground">{billingBlock}</p>
          </div>
        )}
      </div>
    </div>
  );
}
