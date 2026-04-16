import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CreditCard, Archive } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";
import { useTenantUsers } from "@/hooks/useTenantUsers";

interface DiagramLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DiagramLimitDialog({ open, onOpenChange }: DiagramLimitDialogProps) {
  const { billing, openPortal } = useBilling();
  const { currentUser } = useTenantUsers();
  const canManageBilling = currentUser?.role === "owner" || (currentUser?.role === "admin" && currentUser?.can_manage_billing);

  const handleManage = async () => {
    try {
      await openPortal();
    } catch {
      // portal error handled elsewhere
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <AlertTriangle className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">Structure limit reached</DialogTitle>
          <DialogDescription className="text-center">
            Your workspace can have up to {billing?.diagram_limit ?? 3} active structures.
            You're currently using all of them.
            {!canManageBilling && " Contact the firm owner to upgrade or free up a slot."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3.5">
            <Archive className="h-4.5 w-4.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Archive a structure</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Delete an existing structure to free up a slot. Admins can restore deleted structures later.
              </p>
            </div>
          </div>
          {canManageBilling && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <CreditCard className="h-4.5 w-4.5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Upgrade your plan</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get more structures and additional features by upgrading your workspace plan.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {canManageBilling && (
            <Button onClick={handleManage} className="w-full gap-2">
              <CreditCard className="h-4 w-4" />
              Manage Plan
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full text-muted-foreground">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
