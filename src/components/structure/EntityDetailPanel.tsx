import { useState } from "react";
import { X, Pencil, Plus, Star, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPES, getEntityLabel, getEntityIcon } from "@/lib/entityTypes";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const RELATIONSHIP_TYPES = [
  "director", "shareholder", "beneficiary", "trustee",
  "appointer", "settlor", "partner", "member", "spouse", "parent", "child",
] as const;

const OWNERSHIP_REL_TYPES = new Set(["shareholder", "beneficiary", "partner", "member"]);

interface Props {
  entity: EntityNode;
  relationships: RelationshipEdge[];
  allEntities: EntityNode[];
  structureId: string;
  onClose: () => void;
  onSelectEntity: (id: string) => void;
  onEntityUpdated: () => void;
}

export default function EntityDetailPanel({
  entity, relationships, allEntities, structureId, onClose, onSelectEntity, onEntityUpdated,
}: Props) {
  const { toast } = useToast();
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));
  const Icon = getEntityIcon(entity.entity_type);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editType, setEditType] = useState(entity.entity_type);
  const [saving, setSaving] = useState(false);
  const [editIsOperating, setEditIsOperating] = useState(entity.is_operating_entity);
  const [editIsTrustee, setEditIsTrustee] = useState(entity.is_trustee_company);

  // Add relationship state
  const [showAddRel, setShowAddRel] = useState(false);
  const [newRelTarget, setNewRelTarget] = useState("");
  const [newRelType, setNewRelType] = useState("");
  const [newRelOwnershipPercent, setNewRelOwnershipPercent] = useState("");
  const [newRelOwnershipUnits, setNewRelOwnershipUnits] = useState("");
  const [newRelOwnershipClass, setNewRelOwnershipClass] = useState("");
  const [addingRel, setAddingRel] = useState(false);

  const related = relationships
    .filter((r) => r.from_entity_id === entity.id || r.to_entity_id === entity.id)
    .map((r) => {
      const otherId = r.from_entity_id === entity.id ? r.to_entity_id : r.from_entity_id;
      const direction = r.from_entity_id === entity.id ? "outgoing" : "incoming";
      return { ...r, otherId, otherName: entityMap.get(otherId)?.name ?? "Unknown", direction };
    });

  const otherEntities = allEntities.filter((e) => e.id !== entity.id);

  const handleSave = async () => {
    setSaving(true);
    const updates: Record<string, unknown> = {
      name: editName,
      entity_type: editType,
      is_operating_entity: editIsOperating,
      is_trustee_company: editIsTrustee,
    };
    const { error } = await supabase
      .from("entities")
      .update(updates as any)
      .eq("id", entity.id);
    if (error) {
      console.error("Entity update failed:", error);
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity updated" });
      setEditing(false);
      onEntityUpdated();
    }
    setSaving(false);
  };

  const handleAddRelationship = async () => {
    if (!newRelTarget || !newRelType) return;
    const pctVal = newRelOwnershipPercent ? parseFloat(newRelOwnershipPercent) : null;
    if (pctVal != null && (pctVal < 0 || pctVal > 100)) {
      toast({ title: "Invalid percentage", description: "Must be between 0 and 100", variant: "destructive" });
      return;
    }
    setAddingRel(true);

    const { data: entityData } = await supabase
      .from("entities")
      .select("tenant_id")
      .eq("id", entity.id)
      .single();

    if (!entityData) {
      toast({ title: "Error", description: "Could not determine tenant", variant: "destructive" });
      setAddingRel(false);
      return;
    }

    const insertData: Record<string, unknown> = {
      from_entity_id: entity.id,
      to_entity_id: newRelTarget,
      relationship_type: newRelType,
      tenant_id: entityData.tenant_id,
      source: "manual",
    };

    if (OWNERSHIP_REL_TYPES.has(newRelType)) {
      if (newRelOwnershipPercent) insertData.ownership_percent = parseFloat(newRelOwnershipPercent);
      if (newRelOwnershipUnits) insertData.ownership_units = parseFloat(newRelOwnershipUnits);
      if (newRelOwnershipClass) insertData.ownership_class = newRelOwnershipClass;
    }

    const { data: newRel, error } = await supabase
      .from("relationships")
      .insert(insertData as any)
      .select("id")
      .single();

    if (error) {
      console.error("Add relationship failed:", error);
      toast({ title: "Failed to add relationship", description: error.message, variant: "destructive" });
    } else if (newRel) {
      const { error: linkError } = await supabase
        .from("structure_relationships")
        .insert({ structure_id: structureId, relationship_id: newRel.id });

      if (linkError) {
        console.error("Failed to link relationship to structure:", linkError);
      }

      toast({ title: "Relationship added" });
      setShowAddRel(false);
      setNewRelTarget("");
      setNewRelType("");
      setNewRelOwnershipPercent("");
      setNewRelOwnershipUnits("");
      setNewRelOwnershipClass("");
      onEntityUpdated();
    }
    setAddingRel(false);
  };

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Entity Details</h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(true); setEditName(entity.name); setEditType(entity.entity_type); setEditIsOperating(entity.is_operating_entity); setEditIsTrustee(entity.is_trustee_company); }}>
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
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.filter(t => t !== "Unclassified").map((t) => (
                    <SelectItem key={t} value={t}>{getEntityLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="is-operating" checked={editIsOperating} onCheckedChange={setEditIsOperating} />
              <Label htmlFor="is-operating" className="text-xs">Operating Entity</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="is-trustee" checked={editIsTrustee} onCheckedChange={setEditIsTrustee} />
              <Label htmlFor="is-trustee" className="text-xs">Trustee Company</Label>
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
                <p className="text-xs text-muted-foreground">{getEntityLabel(entity.entity_type)}</p>
                {entity.is_operating_entity && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 mt-0.5">
                    <Star className="h-2.5 w-2.5" /> Operating Entity
                  </Badge>
                )}
                {entity.is_trustee_company && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 mt-0.5">
                    <Shield className="h-2.5 w-2.5" /> Trustee Company
                  </Badge>
                )}
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

        {/* Control & Ownership Summary */}
        {!editing && (() => {
          const groups: Record<string, { name: string; id: string }[]> = {
            director: [], trustee: [], appointer: [], settlor: [], shareholder: [], beneficiary: [],
          };
          for (const r of related) {
            if (groups[r.relationship_type]) {
              groups[r.relationship_type].push({ name: r.otherName, id: r.otherId });
            }
          }
          const hasAny = Object.values(groups).some((g) => g.length > 0);
          if (!hasAny) return null;
          return (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Control & Ownership Summary</p>
              {Object.entries(groups).map(([type, items]) =>
                items.length > 0 ? (
                  <div key={type}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {type === "appointer" ? "Appointors" : `${type}s`}
                    </p>
                    {items.map((item) => (
                      <button
                        key={item.id}
                        className="block w-full text-left text-xs truncate rounded px-2 py-0.5 hover:bg-accent transition-colors"
                        onClick={() => onSelectEntity(item.id)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                ) : null
              )}
            </div>
          );
        })()}

        {/* Relationships */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Relationships ({related.length})
            </p>
            {!showAddRel && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowAddRel(true)}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            )}
          </div>

          {/* Add relationship form */}
          {showAddRel && (
            <div className="rounded-md border p-3 space-y-2 mb-3">
              <div>
                <Label className="text-xs">Target Entity</Label>
                <Select value={newRelTarget} onValueChange={setNewRelTarget}>
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
                <Select value={newRelType} onValueChange={setNewRelType}>
                  <SelectTrigger className="h-8 mt-1 text-xs"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {OWNERSHIP_REL_TYPES.has(newRelType) && (
                <>
                  <div>
                    <Label className="text-xs">Ownership %</Label>
                    <Input type="number" value={newRelOwnershipPercent} onChange={(e) => setNewRelOwnershipPercent(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 50" />
                  </div>
                  <div>
                    <Label className="text-xs">Units</Label>
                    <Input type="number" value={newRelOwnershipUnits} onChange={(e) => setNewRelOwnershipUnits(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. 100" />
                  </div>
                  <div>
                    <Label className="text-xs">Class</Label>
                    <Input value={newRelOwnershipClass} onChange={(e) => setNewRelOwnershipClass(e.target.value)} className="h-8 mt-1 text-xs" placeholder="e.g. Ordinary" />
                  </div>
                </>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAddRelationship} disabled={addingRel || !newRelTarget || !newRelType}>
                  {addingRel ? "Adding..." : "Add"}
                </Button>
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setShowAddRel(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

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
