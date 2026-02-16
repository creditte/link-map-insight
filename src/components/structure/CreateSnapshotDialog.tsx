import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createSnapshot } from "@/hooks/useSnapshots";

interface Props {
  structureId: string;
  structureName: string;
  onCreated: () => void;
}

export default function CreateSnapshotDialog({ structureId, structureName, onCreated }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await createSnapshot(structureId, name.trim(), description.trim() || undefined);
      toast({ title: "Snapshot created", description: `"${name}" saved successfully` });
      setOpen(false);
      setName("");
      setDescription("");
      onCreated();
    } catch (e: any) {
      console.error("Snapshot creation failed:", e);
      toast({ title: "Snapshot failed", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Camera className="h-3.5 w-3.5" /> Snapshot
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Snapshot</DialogTitle>
          <DialogDescription>
            Save a point-in-time copy of "{structureName}" including all entities, relationships, and layout positions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="snapshot-name">Name *</Label>
            <Input
              id="snapshot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pre-restructure, FY2024 Final"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="snapshot-desc">Description (optional)</Label>
            <Textarea
              id="snapshot-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief note about what this snapshot captures..."
              className="mt-1"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
