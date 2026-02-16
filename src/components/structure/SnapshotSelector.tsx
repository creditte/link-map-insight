import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Snapshot } from "@/hooks/useSnapshots";

interface Props {
  snapshots: Snapshot[];
  activeSnapshotId: string | null;
  onSelect: (snapshotId: string) => void;
  onReturnToLive: () => void;
}

export default function SnapshotSelector({ snapshots, activeSnapshotId, onSelect, onReturnToLive }: Props) {
  if (snapshots.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={activeSnapshotId ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5"
        >
          <History className="h-3.5 w-3.5" />
          Snapshots ({snapshots.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {activeSnapshotId && (
          <>
            <DropdownMenuItem onClick={onReturnToLive} className="text-primary font-medium">
              ← Return to Live Structure
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {snapshots.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={s.id === activeSnapshotId ? "bg-accent" : ""}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium truncate">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(s.created_at).toLocaleDateString("en-AU", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
