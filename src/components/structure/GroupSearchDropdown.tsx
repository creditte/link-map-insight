import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, Star, X, Network, Loader2, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

interface GroupSearchDropdownProps {
  groups: XpmGroup[];
  loading: boolean;
  favouriteIds: Set<string>;
  onSelect: (group: XpmGroup) => void;
  onToggleFavourite: (group: XpmGroup) => void;
  selectedGroupId?: string | null;
}

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 8;
const OVERSCAN = 4;

export default function GroupSearchDropdown({
  groups,
  loading,
  favouriteIds,
  onSelect,
  onToggleFavourite,
  selectedGroupId,
}: GroupSearchDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch("");
      setScrollTop(0);
    }
  }, [open]);

  const filtered = useMemo(
    () =>
      search.trim()
        ? groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
        : groups,
    [groups, search],
  );

  const totalHeight = filtered.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(filtered.length, Math.ceil((scrollTop + VISIBLE_ITEMS * ITEM_HEIGHT) / ITEM_HEIGHT) + OVERSCAN);
  const visibleItems = filtered.slice(startIndex, endIndex);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleSelect = (g: XpmGroup) => {
    onSelect(g);
    setOpen(false);
  };

  const selectedGroup = groups.find((g) => g.xpm_uuid === selectedGroupId);

  return (
    <div ref={dropdownRef} className="relative w-full max-w-md">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40",
          open && "border-primary ring-1 ring-primary/20",
        )}
      >
        <Network className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className={cn("truncate flex-1 text-left", !selectedGroup && "text-muted-foreground")}>
          {selectedGroup ? selectedGroup.name : "Select a client group…"}
        </span>
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder="Search groups…"
                className="h-8 pl-8 pr-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md" />
              ))}
            </div>
          )}

          {/* Empty — no groups synced */}
          {!loading && groups.length === 0 && (
            <div className="p-6 text-center text-muted-foreground">
              <Settings className="h-6 w-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium">No groups synced yet</p>
              <p className="text-[11px] mt-1">Go to Settings to connect Xero Practice Manager.</p>
            </div>
          )}

          {/* No search results */}
          {!loading && groups.length > 0 && filtered.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">No groups match your search</p>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSearch("")}>
                Clear search
              </Button>
            </div>
          )}

          {/* Virtual scrolled list */}
          {!loading && filtered.length > 0 && (
            <div
              ref={containerRef}
              className="overflow-y-auto"
              style={{ maxHeight: VISIBLE_ITEMS * ITEM_HEIGHT }}
              onScroll={handleScroll}
            >
              <div style={{ height: totalHeight, position: "relative" }}>
                {visibleItems.map((g, i) => {
                  const idx = startIndex + i;
                  const isFav = favouriteIds.has(g.xpm_uuid);
                  return (
                    <div
                      key={g.xpm_uuid}
                      style={{
                        position: "absolute",
                        top: idx * ITEM_HEIGHT,
                        left: 0,
                        right: 0,
                        height: ITEM_HEIGHT,
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 cursor-pointer transition-colors",
                        selectedGroupId === g.xpm_uuid
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      onClick={() => handleSelect(g)}
                    >
                      <Network className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium truncate flex-1">{g.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavourite(g);
                        }}
                        className={cn(
                          "shrink-0 p-1 rounded transition-colors",
                          isFav
                            ? "text-amber-500 hover:text-amber-600"
                            : "text-muted-foreground/40 hover:text-amber-500",
                        )}
                      >
                        <Star className={cn("h-3.5 w-3.5", isFav && "fill-current")} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer count */}
          {!loading && filtered.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
              {filtered.length === groups.length
                ? `${groups.length} groups`
                : `${filtered.length} of ${groups.length} groups`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
