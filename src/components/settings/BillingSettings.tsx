import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Network, ArrowRightLeft, Loader2, ArrowUpCircle, ArrowDownCircle, Clock } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useToast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import PlanSwitchDialog from "./PlanSwitchDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function BillingSettings() {
  const { billing, loading, openPortal, switchBillingInterval, changePlan, reload } = useBilling();
  const { toast } = useToast();
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [planSwitching, setPlanSwitching] = useState(false);

  const isBusy = switching || planSwitching;

  const handleManageBilling = async () => {
    setNavigating(true);
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setNavigating(false);
    }
  };

  const handleSwitchInterval = async () => {
    setSwitching(true);
    try {
      await switchBillingInterval();
      toast({
        title: "Billing interval updated",
        description: `Switched to ${isAnnual ? "monthly" : "annual"} billing successfully.`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSwitching(false);
      setShowSwitchDialog(false);
    }
  };

  const handleCancelDowngrade = async () => {
    setPlanSwitching(true);
    try {
      await changePlan("pro");
      toast({
        title: "Downgrade cancelled",
        description: "Your Pro plan will continue without changes.",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setPlanSwitching(false);
    }
  };

  const currentPlan = billing?.subscription_plan || "pro";
  const hasPendingDowngrade = !!billing?.pending_downgrade;

  const cooldownUntil = billing?.last_plan_switch_at
    ? new Date(new Date(billing.last_plan_switch_at).getTime() + 24 * 60 * 60 * 1000)
    : null;
  const isOnCooldown = cooldownUntil ? new Date() < cooldownUntil : false;

  // If downgrade is pending, the only action is to cancel it (upgrade back to pro)
  const targetPlan = hasPendingDowngrade ? "pro" : (currentPlan === "starter" ? "pro" : "starter");
  const isUpgrade = targetPlan === "pro";

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-36 mt-2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    active: "Active",
    past_due: "Past Due",
    canceled: "Cancelled",
    incomplete: "Incomplete",
    trial_expired: "Trial Expired",
  };

  const statusColors: Record<string, string> = {
    trialing: "bg-primary/10 text-primary border-0",
    active: "bg-success/10 text-success border-0",
    past_due: "bg-warning/10 text-warning border-0",
    canceled: "bg-destructive/10 text-destructive border-0",
    trial_expired: "bg-destructive/10 text-destructive border-0",
  };

  const rawStatus = billing?.subscription_status || "free";
  const status = rawStatus;
  const label = statusLabels[status] || status;
  const colorClass = statusColors[status] || "bg-muted text-muted-foreground border-0";

  const planName = billing?.subscription_plan === "starter" ? "strukcha Starter" : "strukcha Pro";
  const isAnnual = billing?.billing_interval === "year";

  const priceDisplay = (() => {
    if (billing?.price_amount) {
      const amount = billing.price_amount / 100;
      return isAnnual ? `A$${amount.toLocaleString()}/year` : `A$${amount}/month`;
    }
    if (billing?.subscription_plan === "starter") {
      return isAnnual ? "A$990/year" : "A$99/month";
    }
    return isAnnual ? "A$2,490/year" : "A$249/month";
  })();

  const targetIntervalLabel = isAnnual ? "Monthly" : "Annual";
  const targetPriceDisplay = (() => {
    if (billing?.subscription_plan === "starter") {
      return isAnnual ? "A$99/month" : "A$990/year";
    }
    return isAnnual ? "A$249/month" : "A$2,490/year";
  })();

  const diagramCount = billing?.diagram_count ?? 0;
  const diagramLimit = billing?.diagram_limit ?? 15;

  const trialEnd = billing?.trial_ends_at ? new Date(billing.trial_ends_at) : addDays(new Date(), 5);

  const isActive = billing?.subscription_status === "active";

  return (
    <div className="space-y-6 relative">
      {navigating && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Redirecting to billing portal…</p>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{planName}</p>
              <p className="text-xs text-muted-foreground">{priceDisplay}</p>
            </div>
            <Badge className={colorClass}>{label}</Badge>
          </div>

          {isActive && (
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Billing Interval: {isAnnual ? "Annual" : "Monthly"}</p>
                <p className="text-xs text-muted-foreground">
                  {isAnnual ? "You're saving with annual billing" : "Switch to annual to save"}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowSwitchDialog(true)} disabled={isBusy}>
                <ArrowRightLeft className="h-4 w-4" />
                Switch to {targetIntervalLabel}
              </Button>
            </div>
          )}

          {/* Pending downgrade banner */}
          {isActive && hasPendingDowngrade && (
            <div className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-warning">Downgrade to Starter scheduled</p>
                  <p className="text-xs text-muted-foreground">
                    Your plan will switch to Starter at the end of your current billing period
                    {billing?.current_period_end
                      ? ` (${format(new Date(billing.current_period_end), "d MMM yyyy")})`
                      : ""}.
                    You'll keep Pro features until then.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0 ml-3"
                onClick={handleCancelDowngrade}
                disabled={isBusy}
              >
                {planSwitching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
                Keep Pro
              </Button>
            </div>
          )}

          {/* Cooldown notice */}
          {isActive && isOnCooldown && !hasPendingDowngrade && (
            <div className="flex items-start gap-2 rounded-lg border border-muted px-4 py-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Plan switch cooldown</p>
                <p className="text-xs text-muted-foreground">
                  You recently switched plans. You can switch again after{" "}
                  {cooldownUntil ? format(cooldownUntil, "d MMM yyyy 'at' h:mm a") : "24 hours"}.
                </p>
              </div>
            </div>
          )}

          {/* Plan switch button — only show if no pending downgrade and not cancelling */}
          {isActive && !billing?.cancel_at_period_end && !hasPendingDowngrade && (
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Current Plan: {currentPlan === "starter" ? "Starter" : "Pro"}</p>
                <p className="text-xs text-muted-foreground">
                  {isOnCooldown
                    ? "Plan switching is temporarily unavailable"
                    : isUpgrade ? "Upgrade to Pro for more structures and features" : " "}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowPlanDialog(true)} disabled={isBusy || isOnCooldown}>
                {isUpgrade ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                {isUpgrade ? "Upgrade to Pro" : "Switch to Starter"}
              </Button>
            </div>
          )}

          {billing?.subscription_status === "trialing" && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-sm text-primary font-medium">
                Trial ends {format(trialEnd, "d MMM yyyy 'at' h:mm a")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                After your trial, you'll be charged {priceDisplay}.
              </p>
            </div>
          )}

          {billing?.current_period_end && billing.subscription_status === "active" && (
            <p className="text-sm text-muted-foreground">
              Next renewal: {format(new Date(billing.current_period_end), "d MMM yyyy")}
            </p>
          )}

          {billing?.cancel_at_period_end && (
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
              <p className="text-sm text-warning font-medium">Cancellation scheduled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Access continues until{" "}
                {billing.current_period_end
                  ? format(new Date(billing.current_period_end), "d MMM yyyy")
                  : "end of period"}
                .
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleManageBilling} disabled={navigating} className="gap-2">
              {navigating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {navigating ? "Redirecting…" : "Manage Billing"}
            </Button>

            {isActive && !billing?.cancel_at_period_end && (
              <Button
                variant="outline"
                className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={handleManageBilling}
                disabled={navigating}
              >
                Cancel Subscription
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active Structures</p>
              <p className="text-xs text-muted-foreground">
                {diagramCount} of {diagramLimit} used
              </p>
            </div>
            <div className="h-2 w-32 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (diagramCount / diagramLimit) * 100)}%`,
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showSwitchDialog} onOpenChange={setShowSwitchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {targetIntervalLabel} billing?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You will be switched from <span className="font-medium">{isAnnual ? "Annual" : "Monthly"}</span> to{" "}
                <span className="font-medium">{targetIntervalLabel}</span> billing at{" "}
                <span className="font-medium">{targetPriceDisplay}</span>.
              </p>
              <p>
                Your current billing period will be prorated, and the new rate will apply immediately. Any remaining
                balance from your current period will be credited towards the new charge.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSwitchInterval} disabled={switching}>
              {switching ? "Switching…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PlanSwitchDialog
        open={showPlanDialog}
        onOpenChange={setShowPlanDialog}
        currentPlan={currentPlan as "starter" | "pro"}
        isAnnual={isAnnual}
        diagramCount={diagramCount}
        currentPeriodEnd={billing?.current_period_end || null}
        onConfirm={() => changePlan(targetPlan as "starter" | "pro")}
      />
    </div>
  );
}
