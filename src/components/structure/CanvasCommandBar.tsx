import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { EntityNode } from "@/hooks/useStructureData";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: EntityNode[];
  onSelectEntity: (id: string) => void;
}

export default function CanvasCommandBar({ open, onOpenChange, entities, onSelectEntity }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // Global ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  const filtered = query.trim()
    ? entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : entities;

  const handleSelect = useCallback(
    (id: string) => {
      onSelectEntity(id);
      onOpenChange(false);
    },
    [onSelectEntity, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities…"
            className="border-0 shadow-none focus-visible:ring-0 h-11 text-sm"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground shrink-0">
            ESC
          </kbd>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No entities found</p>
          ) : (
            filtered.map((e) => (
              <button
                key={e.id}
                className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent transition-colors"
                onClick={() => handleSelect(e.id)}
              >
                <span className="font-medium truncate">{e.name}</span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{e.entity_type}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
