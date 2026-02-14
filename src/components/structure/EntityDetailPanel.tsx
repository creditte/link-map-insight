import { X, Building2, User, Landmark, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const iconMap: Record<string, React.ElementType> = {
  Individual: User,
  Company: Building2,
  Trust: Landmark,
  Partnership: Users,
};

interface Props {
  entity: EntityNode;
  relationships: RelationshipEdge[];
  allEntities: EntityNode[];
  onClose: () => void;
  onSelectEntity: (id: string) => void;
}

export default function EntityDetailPanel({ entity, relationships, allEntities, onClose, onSelectEntity }: Props) {
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));
  const Icon = iconMap[entity.entity_type] ?? User;

  // Get relationships for this entity
  const related = relationships
    .filter((r) => r.from_entity_id === entity.id || r.to_entity_id === entity.id)
    .map((r) => {
      const otherId = r.from_entity_id === entity.id ? r.to_entity_id : r.from_entity_id;
      const direction = r.from_entity_id === entity.id ? "outgoing" : "incoming";
      return { ...r, otherId, otherName: entityMap.get(otherId)?.name ?? "Unknown", direction };
    });

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold text-sm">Entity Details</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header */}
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
