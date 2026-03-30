import { Network, X } from "lucide-react";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

interface RecentGroupsProps {
  groups: XpmGroup[];
  onSelect: (group: XpmGroup) => void;
}

export default function RecentGroups({ groups, onSelect }: RecentGroupsProps) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent</h3>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.xpm_uuid}
            onClick={() => onSelect(g)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium text-foreground hover:border-primary/40 hover:bg-accent/50 transition-colors"
          >
            <Network className="h-3 w-3 text-muted-foreground" />
            <span className="truncate max-w-[160px]">{g.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
