import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTITY_TYPES, getEntityLabel } from "@/lib/entityTypes";
import type { EntityNode } from "@/hooks/useStructureData";

interface Props {
  entity: EntityNode;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export default function EntityEditForm({ entity, onSave, onCancel }: Props) {
  const [editName, setEditName] = useState(entity.name);
  const [editType, setEditType] = useState(entity.entity_type);
  const [editAbn, setEditAbn] = useState(entity.abn ?? "");
  const [editAcn, setEditAcn] = useState(entity.acn ?? "");
  const [editIsOperating, setEditIsOperating] = useState(entity.is_operating_entity);
  const [editIsTrustee, setEditIsTrustee] = useState(entity.is_trustee_company);
  const [editIsInvestment, setEditIsInvestment] = useState(entity.is_investment_company);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name: editName,
      entity_type: editType,
      abn: editAbn.replace(/\s/g, "") || null,
      acn: editAcn.replace(/\s/g, "") || null,
      is_operating_entity: editIsOperating,
      is_trustee_company: editIsTrustee,
      is_investment_company: editIsInvestment,
    });
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Name</Label>
        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 mt-1" />
      </div>
      <div>
        <Label className="text-xs">Entity Type</Label>
        <Select value={editType} onValueChange={setEditType}>
          <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.filter(t => t !== "Unclassified").map((t) => (
              <SelectItem key={t} value={t}>{getEntityLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">ABN</Label>
        <Input value={editAbn} onChange={(e) => setEditAbn(e.target.value)} placeholder="e.g. 12 345 678 901" className="h-9 mt-1 font-mono" />
      </div>
      <div>
        <Label className="text-xs">ACN</Label>
        <Input value={editAcn} onChange={(e) => setEditAcn(e.target.value)} placeholder="e.g. 123 456 789" className="h-9 mt-1 font-mono" />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="is-operating" checked={editIsOperating} onCheckedChange={setEditIsOperating} />
        <Label htmlFor="is-operating" className="text-xs">Operating Entity</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="is-trustee" checked={editIsTrustee} onCheckedChange={setEditIsTrustee} />
        <Label htmlFor="is-trustee" className="text-xs">Trustee Company</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="is-investment" checked={editIsInvestment} onCheckedChange={setEditIsInvestment} />
        <Label htmlFor="is-investment" className="text-xs">Investment / Bucket Company</Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </div>
  );
}
