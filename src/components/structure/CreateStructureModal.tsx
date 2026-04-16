import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, PenTool, ArrowRight, Loader2, AlertTriangle, CreditCard, Archive } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBilling } from "@/hooks/useBilling";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportXpm: () => void;
}

export default function CreateStructureModal({ open, onOpenChange, onImportXpm }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { billing, openPortal } = useBilling();
  const [creating, setCreating] = useState(false);

  const limitReached = billing ? billing.diagram_count >= billing.diagram_limit : false;

  const handleDrawManually = async () => {
    if (!user?.id) return;
    setCreating(true);
    try {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
      if (!tenantId) throw new Error("Could not determine workspace");

      const { data: structure, error } = await supabase
        .from("structures")
        .insert({
          name: "Untitled Structure",
          tenant_id: tenantId,
        })
        .select("id")
        .single();

      if (error || !structure) throw new Error(error?.message || "Failed to create structure");

      onOpenChange(false);
      navigate(`/structures/${structure.id}?new=manual`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleManage = async () => {
    try {
      await openPortal();
    } catch {
      // handled elsewhere
    }
  };

  // Show limit-reached view instead of create options
  if (limitReached) {
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
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <CreditCard className="h-4.5 w-4.5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Upgrade your plan</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get more structures and additional features by upgrading your workspace plan.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={handleManage} className="w-full gap-2">
              <CreditCard className="h-4 w-4" />
              Manage Plan
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full text-muted-foreground">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Structure</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <button
            onClick={() => { onOpenChange(false); onImportXpm(); }}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-border/60 bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Import from XPM</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Connect to Xero Practice Manager and import client structures automatically.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </button>

          <button
            onClick={handleDrawManually}
            disabled={creating}
            className="group flex flex-col items-start gap-3 rounded-xl border-2 border-border/60 bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              {creating ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              ) : (
                <PenTool className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Draw manually</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Build a structure from scratch by adding entities and relationships directly on the canvas.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
