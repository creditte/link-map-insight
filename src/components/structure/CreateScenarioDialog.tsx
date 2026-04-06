import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  /** When duplicating from a live structure */
  sourceStructureId?: string;
  /** When creating from a snapshot */
  snapshotId?: string;
  structureName: string;
  triggerLabel?: string;
  triggerVariant?: "outline" | "secondary" | "ghost";
}

export default function CreateScenarioDialog({
  sourceStructureId,
  snapshotId,
  structureName,
  triggerLabel = "Create Scenario",
  triggerVariant = "outline",
}: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const response = await supabase.functions.invoke("duplicate-structure", {
        body: {
          source_structure_id: sourceStructureId || undefined,
          snapshot_id: snapshotId || undefined,
          name: name.trim(),
          scenario_label: label.trim() || undefined,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to create scenario");
      }

      const { structure_id } = response.data as { structure_id: string };
      toast({ title: "Scenario created", description: `"${name}" is now in your My Structures tab` });
      setOpen(false);
      setName("");
      setLabel("");
      navigate(`/structures/${structure_id}`);
    } catch (e: any) {
      console.error("Scenario creation failed:", e);
      toast({ title: "Scenario failed", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" className="gap-1.5">
          <Copy className="h-3.5 w-3.5" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Scenario</DialogTitle>
          <DialogDescription>
            Create an independent copy of "{structureName}" that you can modify without affecting the original.
          </DialogDescription>
          <div className="rounded-md border bg-muted/40 px-3 py-2 mt-2 text-xs text-muted-foreground flex items-start gap-2">
            <Copy className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>Your scenario will appear in the <strong className="text-foreground">My Structures</strong> tab on the Structures page, marked with a <strong className="text-foreground">Scenario</strong> badge. You can edit it independently without affecting the original.</span>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="scenario-name">Scenario Name *</Label>
            <Input
              id="scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Post restructure, Option B"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="scenario-label">Label (optional)</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">Short tag shown on the diagram badge, e.g. "Option A"</p>
            <Input
              id="scenario-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Option A, Option B"
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Scenario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
