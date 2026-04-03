import { Badge } from "@/components/ui/badge";
import { RELATIONSHIP_RULES, getRelationshipLabel, isDiscretionaryTrustBeneficiary } from "@/lib/relationshipRules";

const GROUP_ORDER = RELATIONSHIP_RULES.map((r) => r.type);

const GROUP_COLORS: Record<string, string> = {
  director: "bg-blue-500",
  shareholder: "bg-emerald-500",
  trustee: "bg-amber-500",
  beneficiary: "bg-purple-500",
  member: "bg-sky-500",
  appointer: "bg-pink-500",
  settlor: "bg-indigo-500",
  partner: "bg-teal-500",
  spouse: "bg-muted-foreground",
  parent: "bg-violet-500",
  child: "bg-cyan-500",
};

function groupLabel(type: string): string {
  const label = getRelationshipLabel(type);
  if (type === "appointer") return "Appointors";
  if (type === "beneficiary") return "Beneficiaries";
  return label + "s";
}

interface RelatedItem {
  id: string;
  otherId: string;
  otherName: string;
  relationship_type: string;
  direction: string;
  ownership_percent: number | null;
  /** Entity type of the target (to_entity) of this relationship */
  targetEntityType?: string;
}

interface Props {
  related: RelatedItem[];
  onSelectEntity: (id: string) => void;
}

export default function EntityRelationshipsGrouped({ related, onSelectEntity }: Props) {
  if (related.length === 0) {
    return <p className="text-xs text-muted-foreground">No relationships</p>;
  }

  // Group by type
  const groups = new Map<string, RelatedItem[]>();
  for (const r of related) {
    const arr = groups.get(r.relationship_type) ?? [];
    arr.push(r);
    groups.set(r.relationship_type, arr);
  }

  // Sort groups by ORDER
  const sortedTypes = [...groups.keys()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="space-y-3">
      {sortedTypes.map((type) => {
        const items = groups.get(type)!;
        const pillColor = GROUP_COLORS[type] ?? "bg-muted-foreground";
        return (
          <div key={type}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-block h-2 w-2 rounded-full ${pillColor}`} />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {groupLabel(type)}
              </p>
              <span className="text-[10px] text-muted-foreground">({items.length})</span>
            </div>
            <div className="space-y-1">
              {items.map((r) => (
                <button
                  key={r.id}
                  className="flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => onSelectEntity(r.otherId)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-xs">{r.otherName}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {r.direction === "outgoing" ? "→" : "←"}
                      </span>
                      {r.ownership_percent != null && !(r.targetEntityType && isDiscretionaryTrustBeneficiary(r.relationship_type, r.targetEntityType)) && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {r.ownership_percent}%
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
