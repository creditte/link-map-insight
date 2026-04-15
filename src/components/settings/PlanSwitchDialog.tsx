import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, ArrowDownCircle, Loader2, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface PlanSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: "starter" | "pro";
  isAnnual: boolean;
  diagramCount: number;
  onConfirm: () => Promise<void>;
}

const PLAN_DETAILS = {
  starter: {
    name: "strukcha Starter",
    limit: 15,
    features: [
      "Up to 15 active structures",
      "All core diagramming features",
      "PDF export",
      "Email support",
    ],
  },
  pro: {
    name: "strukcha Pro",
    limit: 50,
    features: [
      "Up to 50 active structures",
      "All Starter features",
      "AI-powered analysis",
      "Snapshots & scenarios",
      "Priority support",
    ],
  },
};

const PRICING = {
  starter: { monthly: "A$99/month", annual: "A$990/year" },
  pro: { monthly: "A$249/month", annual: "A$2,490/year" },
};

export default function PlanSwitchDialog({
  open,
  onOpenChange,
  currentPlan,
  isAnnual,
  diagramCount,
  onConfirm,
}: PlanSwitchDialogProps) {
  const [loading, setLoading] = useState(false);

  const targetPlan = currentPlan === "starter" ? "pro" : "starter";
  const isUpgrade = targetPlan === "pro";
  const target = PLAN_DETAILS[targetPlan];
  const targetPrice = isAnnual ? PRICING[targetPlan].annual : PRICING[targetPlan].monthly;
  const currentPrice = isAnnual ? PRICING[currentPlan].annual : PRICING[currentPlan].monthly;
  const willExceedLimit = !isUpgrade && diagramCount > PLAN_DETAILS[targetPlan].limit;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      toast.success(`Switched to ${target.name}`, {
        description: `Your plan has been updated. New rate: ${targetPrice}.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Plan switch failed", {
        description: err.message || "Please try again or contact support.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isUpgrade ? (
              <ArrowUpCircle className="h-5 w-5 text-primary" />
            ) : (
              <ArrowDownCircle className="h-5 w-5 text-warning" />
            )}
            {isUpgrade ? "Upgrade to Pro" : "Switch to Starter"}
          </DialogTitle>
          <DialogDescription>
            Review the changes below before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Plan comparison */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex-1 text-center">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-sm font-medium">{PLAN_DETAILS[currentPlan].name}</p>
              <p className="text-xs text-muted-foreground">{currentPrice}</p>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="flex-1 text-center">
              <p className="text-xs text-muted-foreground">New</p>
              <p className="text-sm font-medium">{target.name}</p>
              <Badge variant="secondary" className="mt-0.5 text-xs">{targetPrice}</Badge>
            </div>
          </div>

          {/* What's included */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {isUpgrade ? "What you'll get" : "What's included"}
            </p>
            <ul className="space-y-1.5">
              {target.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Billing impact */}
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Billing impact
            </p>
            {isUpgrade ? (
              <p className="text-sm text-muted-foreground">
                The price difference will be prorated and added to your next invoice. 
                Your new rate of <span className="font-medium text-foreground">{targetPrice}</span> applies immediately.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your plan will be downgraded immediately. The reduced rate of{" "}
                <span className="font-medium text-foreground">{targetPrice}</span> will 
                apply from your next billing cycle with a prorated credit.
              </p>
            )}
          </div>

          {/* Capacity warning for downgrades */}
          {willExceedLimit && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning">Over capacity</p>
                <p className="text-xs text-muted-foreground">
                  You have {diagramCount} active structures but Starter allows {PLAN_DETAILS.starter.limit}. 
                  Please archive structures before switching.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || willExceedLimit}
            className="gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Switching…
              </>
            ) : (
              <>
                {isUpgrade ? "Confirm Upgrade" : "Confirm Switch"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
