import { useState } from "react";
import { History, Eye, Copy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import CreateScenarioDialog from "./CreateScenarioDialog";
import type { Snapshot } from "@/hooks/useSnapshots";

interface Props {
  snapshots: Snapshot[];
  activeSnapshotId: string | null;
  onSelect: (snapshotId: string) => void;
  onReturnToLive: () => void;
  structureName?: string;
}

export default function SnapshotSelector({ snapshots, activeSnapshotId, onSelect, onReturnToLive, structureName }: Props) {
  const [open, setOpen] = useState(false);

  if (snapshots.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant={activeSnapshotId ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5"
        >
          <History className="h-3.5 w-3.5" />
          Snapshots ({snapshots.length})
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">Snapshots</SheetTitle>
          <p className="text-xs text-muted-foreground">Point-in-time copies of this structure</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {activeSnapshotId && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 mb-3 text-primary font-medium"
              onClick={() => { onReturnToLive(); setOpen(false); }}
            >
              ← Return to Live Structure
            </Button>
          )}

          {snapshots.map((s) => (
            <div
              key={s.id}
              className={`rounded-lg border p-3 space-y-2 transition-colors ${
                s.id === activeSnapshotId ? "border-primary bg-accent/50" : "hover:bg-accent/30"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                  )}
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    {new Date(s.created_at).toLocaleDateString("en-AU", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {s.id === activeSnapshotId && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">Viewing</Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs h-7"
                  onClick={() => { onSelect(s.id); setOpen(false); }}
                >
                  <Eye className="h-3 w-3" /> View
                </Button>
                <CreateScenarioDialog
                  snapshotId={s.id}
                  structureName={s.name}
                  triggerLabel="Restore as Scenario"
                  triggerVariant="ghost"
                />
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
