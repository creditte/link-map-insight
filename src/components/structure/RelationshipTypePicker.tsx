import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const RELATIONSHIP_TYPES = [
  { value: "beneficiary", label: "Beneficiary" },
  { value: "shareholder", label: "Shareholder" },
  { value: "trustee", label: "Trustee" },
  { value: "appointer", label: "Appointor" },
  { value: "director", label: "Director" },
  { value: "member", label: "Unitholder / Member" },
  { value: "partner", label: "Partner" },
  { value: "settlor", label: "Settlor" },
];

interface Props {
  open: boolean;
  fromEntityName: string;
  toEntityName: string;
  onConfirm: (relationshipType: string) => void;
  onCancel: () => void;
}

export default function RelationshipTypePicker({ open, fromEntityName, toEntityName, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState("");

  if (!open) return null;

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
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select relationship type..." />
        </SelectTrigger>
        <SelectContent>
          {RELATIONSHIP_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!selected} onClick={() => onConfirm(selected)}>
          Add
        </Button>
      </div>
    </div>
  );
}
