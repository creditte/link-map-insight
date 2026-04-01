import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Info } from "lucide-react";
import {
  RELATIONSHIP_RULES,
  getValidRelationshipTypes,
  getRelationshipLabel,
} from "@/lib/relationshipRules";

const ALL_TYPE_VALUES = RELATIONSHIP_RULES.map((r) => r.type);

interface Props {
  open: boolean;
  fromEntityName: string;
  toEntityName: string;
  fromEntityType?: string;
  toEntityType?: string;
  onConfirm: (relationshipType: string) => void;
  onCancel: () => void;
}

export default function RelationshipTypePicker({ open, fromEntityName, toEntityName, fromEntityType, toEntityType, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState("");

  if (!open) return null;

  const validTypes =
    fromEntityType && toEntityType
      ? getValidRelationshipTypes(ALL_TYPE_VALUES, fromEntityType, toEntityType)
      : ALL_TYPE_VALUES;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 rounded-lg border bg-card shadow-lg p-4 w-80 animate-in fade-in-0 zoom-in-95">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Add Relationship</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3 truncate">
        {fromEntityName} → {toEntityName}
      </p>
      {validTypes.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Info className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">
            No valid relationship types for this entity combination.
          </p>
        </div>
      ) : (
        <>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select relationship type..." />
            </SelectTrigger>
            <SelectContent>
              {validTypes.map((t) => (
                <SelectItem key={t} value={t}>{getRelationshipLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fromEntityType && toEntityType && validTypes.length < ALL_TYPE_VALUES.length && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Only relationship types valid for this entity pair are shown.
            </p>
          )}
        </>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!selected} onClick={() => onConfirm(selected)}>
          Add
        </Button>
      </div>
    </div>
  );
}
