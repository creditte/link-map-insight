import { useState } from "react";
import { X, Pencil, Trash2, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getEntityLabel } from "@/lib/entityTypes";
import {
  RELATIONSHIP_RULES,
  isDirectionValid,
  isReverseAllowed,
  getDirectionError,
  getRelationshipLabel,
  getMetadataFields,
  hasMetadataFields,
  getValidRelationshipTypes,
} from "@/lib/relationshipRules";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const ALL_TYPE_VALUES = RELATIONSHIP_RULES.map((r) => r.type);

interface Props {
  relationship: RelationshipEdge;
  allEntities: EntityNode[];
  allRelationships: RelationshipEdge[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function RelationshipDetailPanel({ relationship, allEntities, allRelationships, onClose, onUpdated }: Props) {
  const { toast } = useToast();
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));
  const fromEntity = entityMap.get(relationship.from_entity_id);
  const toEntity = entityMap.get(relationship.to_entity_id);

  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState(relationship.relationship_type);
  const [editPercent, setEditPercent] = useState(relationship.ownership_percent?.toString() ?? "");
  const [editUnits, setEditUnits] = useState(relationship.ownership_units?.toString() ?? "");
  const [editClass, setEditClass] = useState(relationship.ownership_class ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [reversing, setReversing] = useState(false);

  // Check if current relationship is invalid per rules
  const isInvalid = fromEntity && toEntity
    ? !isDirectionValid(relationship.relationship_type, fromEntity.entity_type, toEntity.entity_type)
    : false;
  const invalidMessage = fromEntity && toEntity
    ? getDirectionError(relationship.relationship_type, fromEntity.entity_type, toEntity.entity_type)
    : null;

  // Valid types for editing (filtered by entity pair)
  const editValidTypes = fromEntity && toEntity
    ? getValidRelationshipTypes(ALL_TYPE_VALUES, fromEntity.entity_type, toEntity.entity_type)
    : [...ALL_TYPE_VALUES];

  const editMeta = getMetadataFields(editType);

  const handleSave = async () => {
    // Validate the new type against entity types
    if (fromEntity && toEntity) {
      const error = getDirectionError(editType, fromEntity.entity_type, toEntity.entity_type);
      if (error) {
        toast({ title: "Invalid relationship", description: error, variant: "destructive" });
        return;
      }
    }

    const pctVal = editPercent ? parseFloat(editPercent) : null;
    if (pctVal != null && (pctVal < 0 || pctVal > 100)) {
      toast({ title: "Invalid percentage", description: "Must be between 0 and 100", variant: "destructive" });
      return;
    }
    setSaving(true);
    const updates: Record<string, unknown> = { relationship_type: editType };
    if (hasMetadataFields(editType)) {
      updates.ownership_percent = pctVal;
      updates.ownership_units = editUnits ? parseFloat(editUnits) : null;
      updates.ownership_class = editClass || null;
    } else {
      updates.ownership_percent = null;
      updates.ownership_units = null;
      updates.ownership_class = null;
    }
    const { error } = await supabase
      .from("relationships")
      .update(updates as any)
      .eq("id", relationship.id);
    if (error) {
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
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Relationship deleted" });
      onClose();
      onUpdated();
    }
    setDeleting(false);
  };

  // Check if reversing would fix an invalid relationship
  const wouldReverseBeValid = fromEntity && toEntity
    ? isDirectionValid(relationship.relationship_type, toEntity.entity_type, fromEntity.entity_type)
    : false;

  const handleReverseClick = () => {
    // Allow reverse if the relationship is currently invalid and reversing would fix it
    if (!isInvalid && !isReverseAllowed(relationship.relationship_type, fromEntity?.entity_type ?? "Unclassified", toEntity?.entity_type ?? "Unclassified")) {
      toast({
        title: "Cannot reverse",
        description: "This relationship type has a required direction and cannot be reversed.",
        variant: "destructive",
      });
      return;
    }

    if (isInvalid && !wouldReverseBeValid) {
      toast({
        title: "Cannot reverse",
        description: "Reversing would not fix this invalid relationship. Consider deleting it instead.",
        variant: "destructive",
      });
      return;
    }

    const duplicate = allRelationships.find(
      (r) =>
        r.id !== relationship.id &&
        r.from_entity_id === relationship.to_entity_id &&
        r.to_entity_id === relationship.from_entity_id &&
        r.relationship_type === relationship.relationship_type
    );
    if (duplicate) {
      toast({
        title: "Duplicate exists",
        description: "A relationship with the reversed direction already exists.",
        variant: "destructive",
      });
      return;
    }

    setConfirmReverse(true);
  };

  const handleReverseConfirm = async () => {
    setReversing(true);
    const { error } = await supabase
      .from("relationships")
      .update({
        from_entity_id: relationship.to_entity_id,
        to_entity_id: relationship.from_entity_id,
      } as any)
      .eq("id", relationship.id);

    if (error) {
      toast({ title: "Reverse failed", description: error.message, variant: "destructive" });
    } else {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("tenant_id, user_id")
          .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .single();
        if (profile) {
          await supabase.from("audit_log").insert({
            tenant_id: profile.tenant_id,
            user_id: profile.user_id,
            action: "relationship_reverse",
            entity_type: "relationship",
            entity_id: relationship.id,
            before_state: { from_entity_id: relationship.from_entity_id, to_entity_id: relationship.to_entity_id, relationship_type: relationship.relationship_type } as any,
            after_state: { from_entity_id: relationship.to_entity_id, to_entity_id: relationship.from_entity_id, relationship_type: relationship.relationship_type } as any,
          });
        }
      } catch (e) {
        console.error("Audit log for reversal failed:", e);
      }
      toast({ title: "Relationship reversed" });
      setConfirmReverse(false);
      onUpdated();
    }
    setReversing(false);
  };

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Relationship Details</h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Reverse direction" onClick={handleReverseClick}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(true); setEditType(relationship.relationship_type); setEditPercent(relationship.ownership_percent?.toString() ?? ""); setEditUnits(relationship.ownership_units?.toString() ?? ""); setEditClass(relationship.ownership_class ?? ""); }}>
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
        {/* Invalid relationship banner */}
        {isInvalid && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium text-destructive">Invalid Relationship</p>
              <p className="text-xs text-destructive/80 mt-0.5">{invalidMessage}</p>
              <div className="flex gap-2 mt-2">
                {wouldReverseBeValid && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReverseClick}>
                    <ArrowLeftRight className="h-3 w-3 mr-1" /> Fix Direction
                  </Button>
                )}
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Reverse confirmation */}
        {confirmReverse && (
          <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium">Reverse direction?</p>
            <p className="text-xs text-muted-foreground">
              This will change: {fromEntity?.name ?? "?"} —({getRelationshipLabel(relationship.relationship_type)})→ {toEntity?.name ?? "?"}{" "}
              to {toEntity?.name ?? "?"} —({getRelationshipLabel(relationship.relationship_type)})→ {fromEntity?.name ?? "?"}
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleReverseConfirm} disabled={reversing}>
                {reversing ? "Reversing..." : "Confirm"}
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmReverse(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
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
            <Select value={editValidTypes.includes(editType) ? editType : ""} onValueChange={setEditType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {editValidTypes.map((t) => (
                  <SelectItem key={t} value={t}>{getRelationshipLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary" className="text-xs">{getRelationshipLabel(relationship.relationship_type)}</Badge>
          )}
        </div>

        {/* Metadata fields */}
        {(editing ? editMeta : getMetadataFields(relationship.relationship_type)).length > 0 && (
          editing ? (
            <>
              {editMeta.includes("ownership_percent") && (
                <div>
                  <Label className="text-xs">Ownership %</Label>
                  <Input type="number" min={0} max={100} value={editPercent} onChange={(e) => setEditPercent(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 50" />
                </div>
              )}
              {editMeta.includes("ownership_units") && (
                <div>
                  <Label className="text-xs">Units</Label>
                  <Input type="number" value={editUnits} onChange={(e) => setEditUnits(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 100" />
                </div>
              )}
              {editMeta.includes("ownership_class") && (
                <div>
                  <Label className="text-xs">Class</Label>
                  <Input value={editClass} onChange={(e) => setEditClass(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. Ordinary" />
                </div>
              )}
            </>
          ) : (
            <>
              {relationship.ownership_percent != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Ownership %</p>
                  <p className="text-sm">{relationship.ownership_percent}%</p>
                </div>
              )}
              {relationship.ownership_units != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Units</p>
                  <p className="text-sm">{relationship.ownership_units}</p>
                </div>
              )}
              {relationship.ownership_class && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Class</p>
                  <p className="text-sm">{relationship.ownership_class}</p>
                </div>
              )}
            </>
          )
        )}

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
