import { useState } from "react";
import { X, Building2, User, Landmark, Users, Store, Building, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const ENTITY_TYPES = [
  "Individual", "Company", "Trust", "Partnership",
  "Sole Trader", "Incorporated Association/Club",
] as const;

const TRUST_SUBTYPES = [
  "Discretionary", "Unit", "Hybrid", "Bare",
  "Testamentary", "Deceased Estate", "Family Trust", "SMSF",
] as const;

const iconMap: Record<string, React.ElementType> = {
  Individual: User,
  Company: Building2,
  Trust: Landmark,
  Partnership: Users,
  "Sole Trader": Store,
  "Incorporated Association/Club": Building,
  Unclassified: User,
};

interface Props {
  entity: EntityNode;
  relationships: RelationshipEdge[];
  allEntities: EntityNode[];
  onClose: () => void;
  onSelectEntity: (id: string) => void;
  onEntityUpdated: () => void;
}

export default function EntityDetailPanel({
  entity, relationships, allEntities, onClose, onSelectEntity, onEntityUpdated,
}: Props) {
  const { toast } = useToast();
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));
  const Icon = iconMap[entity.entity_type] ?? User;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editType, setEditType] = useState(entity.entity_type);
  const [saving, setSaving] = useState(false);

  const related = relationships
    .filter((r) => r.from_entity_id === entity.id || r.to_entity_id === entity.id)
    .map((r) => {
      const otherId = r.from_entity_id === entity.id ? r.to_entity_id : r.from_entity_id;
      const direction = r.from_entity_id === entity.id ? "outgoing" : "incoming";
      return { ...r, otherId, otherName: entityMap.get(otherId)?.name ?? "Unknown", direction };
    });

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("entities")
      .update({ name: editName, entity_type: editType as any })
      .eq("id", entity.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity updated" });
      setEditing(false);
      onEntityUpdated();
    }
    setSaving(false);
  };

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Entity Details</h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(true); setEditName(entity.name); setEditType(entity.entity_type); }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Entity Type</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium leading-tight">{entity.name}</p>
                <p className="text-xs text-muted-foreground">{entity.entity_type}</p>
              </div>
            </div>

            {entity.xpm_uuid && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">XPM UUID</p>
                <p className="text-xs font-mono break-all">{entity.xpm_uuid}</p>
              </div>
            )}
          </>
        )}

        {/* Relationships */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Relationships ({related.length})
          </p>
          <div className="space-y-2">
            {related.length === 0 && (
              <p className="text-xs text-muted-foreground">No relationships</p>
            )}
            {related.map((r) => (
              <button
                key={r.id}
                className="flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent"
                onClick={() => onSelectEntity(r.otherId)}
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-xs">{r.otherName}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {r.relationship_type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {r.direction === "outgoing" ? "→" : "←"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
