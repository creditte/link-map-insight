import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTITY_TYPES, getEntityLabel } from "@/lib/entityTypes";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structureId: string;
  tenantId: string;
  onEntityCreated: () => void;
}

export default function AddEntityDialog({ open, onOpenChange, structureId, tenantId, onEntityCreated }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState("Unclassified");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);

    const { data: entity, error } = await supabase
      .from("entities")
      .insert({ name: name.trim(), entity_type: entityType as any, tenant_id: tenantId, source: "manual" as any })
      .select("id")
      .single();

    if (error || !entity) {
      toast({ title: "Failed to create entity", description: error?.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    const { error: linkError } = await supabase
      .from("structure_entities")
      .insert({ structure_id: structureId, entity_id: entity.id });

    if (linkError) {
      console.error("Failed to link entity to structure:", linkError);
    }

    toast({ title: "Entity created", description: name.trim() });
    setName("");
    setEntityType("Unclassified");
    setSaving(false);
    onOpenChange(false);
    onEntityCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Entity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Entity name"
              className="mt-1"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && !saving && name.trim() && handleCreate()}
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{getEntityLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
