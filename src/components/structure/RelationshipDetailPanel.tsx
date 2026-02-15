import { useState } from "react";
import { X, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getEntityLabel } from "@/lib/entityTypes";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const RELATIONSHIP_TYPES = [
  "director", "shareholder", "beneficiary", "trustee",
  "appointer", "settlor", "partner", "member", "spouse", "parent", "child",
] as const;

interface Props {
  relationship: RelationshipEdge;
  allEntities: EntityNode[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function RelationshipDetailPanel({ relationship, allEntities, onClose, onUpdated }: Props) {
  const { toast } = useToast();
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));
  const fromEntity = entityMap.get(relationship.from_entity_id);
  const toEntity = entityMap.get(relationship.to_entity_id);

  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState(relationship.relationship_type);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("relationships")
      .update({ relationship_type: editType as any })
      .eq("id", relationship.id);
    if (error) {
      console.error("Relationship update failed:", error);
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Relationship updated" });
      setEditing(false);
      onUpdated();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase
      .from("relationships")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", relationship.id);
    if (error) {
      console.error("Relationship delete failed:", error);
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Relationship deleted" });
      onClose();
      onUpdated();
    }
    setDeleting(false);
  };

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Relationship Details</h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(true); setEditType(relationship.relationship_type); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {confirmDelete && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs font-medium">Delete this relationship?</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" className="flex-1 h-7 text-xs" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">From</p>
          <div className="rounded-md border p-3">
            <p className="font-medium text-sm">{fromEntity?.name ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground">{getEntityLabel(fromEntity?.entity_type ?? "Unclassified")}</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Type</p>
          {editing ? (
            <Select value={editType} onValueChange={setEditType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary" className="text-xs">{relationship.relationship_type}</Badge>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">To</p>
          <div className="rounded-md border p-3">
            <p className="font-medium text-sm">{toEntity?.name ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground">{getEntityLabel(toEntity?.entity_type ?? "Unclassified")}</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Source</p>
          <Badge variant="outline" className="text-xs">{relationship.source_data}</Badge>
        </div>

        {editing && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
