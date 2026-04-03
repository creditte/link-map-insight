import { useState } from "react";
import { X, Pencil, Plus, Star, Shield, DollarSign, Eye, EyeOff } from "lucide-react";
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
import EntityEditForm from "./EntityEditForm";
import EntityInfoFields from "./EntityInfoFields";
import EntityRelationshipsGrouped from "./EntityRelationshipsGrouped";
import EntityAddRelationshipForm from "./EntityAddRelationshipForm";

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
  const [showAddRel, setShowAddRel] = useState(false);

  const related = relationships
    .filter((r) => r.from_entity_id === entity.id || r.to_entity_id === entity.id)
    .map((r) => {
      const otherId = r.from_entity_id === entity.id ? r.to_entity_id : r.from_entity_id;
      const direction = r.from_entity_id === entity.id ? "outgoing" : "incoming";
      const toEntity = entityMap.get(r.to_entity_id);
      return { ...r, otherId, otherName: entityMap.get(otherId)?.name ?? "Unknown", direction, targetEntityType: toEntity?.entity_type };
    });

  const handleSave = async (updates: Record<string, unknown>) => {
    const { error } = await supabase
      .from("entities")
      .update(updates as any)
      .eq("id", entity.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity updated" });
      setEditing(false);
      onEntityUpdated();
    }
  };

  const handleAddRelationship = async (insertData: Record<string, unknown>) => {
    const { data: entityData } = await supabase
      .from("entities")
      .select("tenant_id")
      .eq("id", entity.id)
      .single();

    if (!entityData) {
      toast({ title: "Error", description: "Could not determine tenant", variant: "destructive" });
      return;
    }

    const fullData = {
      ...insertData,
      from_entity_id: entity.id,
      tenant_id: entityData.tenant_id,
      source: "manual",
    };

    const { data: newRel, error } = await supabase
      .from("relationships")
      .insert(fullData as any)
      .select("id")
      .single();

    if (error) {
      toast({ title: "Failed to add relationship", description: error.message, variant: "destructive" });
    } else if (newRel) {
      const { error: linkError } = await supabase
        .from("structure_relationships")
        .insert({ structure_id: structureId, relationship_id: newRel.id });

      if (linkError) console.error("Failed to link relationship to structure:", linkError);

      toast({ title: "Relationship added" });
      setShowAddRel(false);
      onEntityUpdated();
    }
  };

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Entity Details</h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
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
          <EntityEditForm entity={entity} onSave={handleSave} onCancel={() => setEditing(false)} />
        ) : (
          <>
            {/* Entity header */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium leading-tight">{entity.name}</p>
                <p className="text-xs text-muted-foreground">{getEntityLabel(entity.entity_type)}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {entity.is_operating_entity && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                      <Star className="h-2.5 w-2.5" /> Operating Entity
                    </Badge>
                  )}
                  {entity.is_trustee_company && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                      <Shield className="h-2.5 w-2.5" /> Trustee Company
                    </Badge>
                  )}
                  {entity.is_investment_company && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                      <DollarSign className="h-2.5 w-2.5" /> Investment Company
                    </Badge>
                  )}
                  {entity.is_archived ? (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Archived</Badge>
                  ) : (
                    <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-transparent">Active</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Additional info fields */}
            <EntityInfoFields entity={entity} />

            {entity.xpm_uuid && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">XPM UUID</p>
                <p className="text-xs font-mono break-all">{entity.xpm_uuid}</p>
              </div>
            )}
          </>
        )}

        {/* Relationships */}
        {!editing && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Relationships</p>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem] justify-center">
                  {related.length}
                </Badge>
              </div>
              {!showAddRel && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowAddRel(true)}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
              )}
            </div>

            {showAddRel && (
              <EntityAddRelationshipForm
                allEntities={allEntities}
                currentEntityId={entity.id}
                onAdd={handleAddRelationship}
                onCancel={() => setShowAddRel(false)}
              />
            )}

            <EntityRelationshipsGrouped
              related={related}
              onSelectEntity={onSelectEntity}
            />
          </div>
        )}
      </div>
    </div>
  );
}
