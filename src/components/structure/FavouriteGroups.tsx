import { Network, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

interface FavouriteGroupsProps {
  groups: XpmGroup[];
  onSelect: (group: XpmGroup) => void;
  onRemove: (group: XpmGroup) => void;
}

export default function FavouriteGroups({ groups, onSelect, onRemove }: FavouriteGroupsProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Favourites</h3>
      {groups.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
          <Star className="h-3 w-3" />
          Star a group to add it here
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g.xpm_uuid}
              onClick={() => onSelect(g)}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/5 text-xs font-medium text-foreground hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors"
            >
              <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
              <span className="truncate max-w-[160px]">{g.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
