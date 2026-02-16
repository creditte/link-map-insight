import { useState, useEffect } from "react";
import { History, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Snapshot } from "@/hooks/useSnapshots";

interface Props {
  structureId: string;
  snapshots: Snapshot[];
  onView: (snapshotId: string) => void;
}

export default function SnapshotListModal({ structureId, snapshots, onView }: Props) {
  const [open, setOpen] = useState(false);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open || snapshots.length === 0) return;
    const userIds = [...new Set(snapshots.map((s) => s.created_by))];
    supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds)
      .then(({ data }) => {
        const map = new Map<string, string>();
        for (const p of data ?? []) {
          map.set(p.user_id, p.full_name || "Unknown");
        }
        setUserNames(map);
      });
  }, [open, snapshots]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <History className="h-3 w-3" />
          {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Structure Snapshots</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No snapshots yet</p>
          ) : (
            snapshots.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString("en-AU", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      by {userNames.get(s.created_by) ?? "..."}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 shrink-0"
                  onClick={() => {
                    setOpen(false);
                    onView(s.id);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" /> View
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
