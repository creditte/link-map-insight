const EDGE_COLORS: Record<string, string> = {
  director: "#3b82f6",
  shareholder: "#10b981",
  beneficiary: "#f59e0b",
  trustee: "#8b5cf6",
  appointer: "#ec4899",
  settlor: "#6366f1",
  partner: "#14b8a6",
  member: "#0ea5e9",
  spouse: "#f43f5e",
  parent: "#a855f7",
  child: "#06b6d4",
};

interface Props {
  visible: boolean;
  onToggle: () => void;
}

export default function RelationshipLegend({ visible, onToggle }: Props) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-lg border bg-card p-3 shadow-md">
      <p className="text-xs font-semibold text-muted-foreground mb-2">Relationship Types</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {Object.entries(EDGE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-2">
            <div
              className="h-2.5 w-5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
