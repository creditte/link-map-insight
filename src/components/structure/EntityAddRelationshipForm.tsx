import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Info } from "lucide-react";
import {
  RELATIONSHIP_RULES,
  getValidRelationshipTypes,
  getDirectionError,
  getMetadataFields,
  getEffectiveMetadataFields,
  hasMetadataFields,
  getRelationshipLabel,
  isDiscretionaryTrustBeneficiary,
} from "@/lib/relationshipRules";
import type { EntityNode } from "@/hooks/useStructureData";

const ALL_TYPES = RELATIONSHIP_RULES.map((r) => r.type);

interface Props {
  allEntities: EntityNode[];
  currentEntityId: string;
  onAdd: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export default function EntityAddRelationshipForm({ allEntities, currentEntityId, onAdd, onCancel }: Props) {
  const { toast } = useToast();
  const [target, setTarget] = useState("");
  const [type, setType] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  const [ownershipUnits, setOwnershipUnits] = useState("");
  const [ownershipClass, setOwnershipClass] = useState("");
  const [adding, setAdding] = useState(false);

  const currentEntity = allEntities.find((e) => e.id === currentEntityId);
  const otherEntities = allEntities.filter((e) => e.id !== currentEntityId);

  const targetEntity = allEntities.find((e) => e.id === target);
  const validTypes = useMemo(() => {
    if (!currentEntity || !targetEntity) return [...ALL_TYPES];
    return getValidRelationshipTypes(ALL_TYPES, currentEntity.entity_type, targetEntity.entity_type);
  }, [currentEntity, targetEntity]);

  const effectiveType = validTypes.includes(type) ? type : "";

  const meta = useMemo(() => {
    if (targetEntity && isDiscretionaryTrustBeneficiary(effectiveType, targetEntity.entity_type)) return [] as const;
    return getMetadataFields(effectiveType);
  }, [effectiveType, targetEntity]);
  const showPercent = meta.includes("ownership_percent");
  const showUnits = meta.includes("ownership_units");
  const showClass = meta.includes("ownership_class");

  const handleSubmit = async () => {
    if (!target || !effectiveType) return;

    if (currentEntity && targetEntity) {
      const error = getDirectionError(effectiveType, currentEntity.entity_type, targetEntity.entity_type);
      if (error) {
        toast({ title: "Invalid relationship", description: error, variant: "destructive" });
        return;
      }
    }

    const pct = ownershipPercent ? parseFloat(ownershipPercent) : null;
    if (pct != null && (pct < 0 || pct > 100)) {
      toast({ title: "Invalid percentage", description: "Must be between 0 and 100", variant: "destructive" });
      return;
    }
    setAdding(true);

    const data: Record<string, unknown> = {
      to_entity_id: target,
      relationship_type: effectiveType,
    };

    if (hasMetadataFields(effectiveType)) {
      if (ownershipPercent) data.ownership_percent = parseFloat(ownershipPercent);
      if (ownershipUnits) data.ownership_units = parseFloat(ownershipUnits);
      if (ownershipClass) data.ownership_class = ownershipClass;
    }

    await onAdd(data);
    setAdding(false);
  };

  return (
    <div className="rounded-md border p-3 space-y-2 mb-3">
      <div>
        <Label className="text-xs">Target Entity</Label>
        <Select value={target} onValueChange={(v) => { setTarget(v); setType(""); }}>
          <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select entity" /></SelectTrigger>
          <SelectContent>
            {otherEntities.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Type</Label>
        <Select value={effectiveType} onValueChange={setType}>
          <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {validTypes.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{getRelationshipLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {target && validTypes.length < ALL_TYPES.length && (
          <div className="flex items-start gap-1.5 mt-1.5">
            <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              Only valid relationship types for this entity pair are shown.
            </p>
          </div>
        )}
      </div>
      {showPercent && (
        <div>
          <Label className="text-xs">Ownership %</Label>
          <Input type="number" value={ownershipPercent} onChange={(e) => setOwnershipPercent(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 50" />
        </div>
      )}
      {showUnits && (
        <div>
          <Label className="text-xs">Units</Label>
          <Input type="number" value={ownershipUnits} onChange={(e) => setOwnershipUnits(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 100" />
        </div>
      )}
      {showClass && (
        <div>
          <Label className="text-xs">Class</Label>
          <Input value={ownershipClass} onChange={(e) => setOwnershipClass(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. Ordinary" />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSubmit} disabled={adding || !target || !effectiveType}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
