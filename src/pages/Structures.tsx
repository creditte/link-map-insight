import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Users, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { toast } from "sonner";
import GroupStructureViewer from "@/components/structure/GroupStructureViewer";
import XpmGroupCards from "@/components/structure/XpmGroupCards";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

const COLLAPSED_WIDTH = 52;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;

export default function Structures() {
  const [selectedGroup, setSelectedGroup] = useState<XpmGroup | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // Groups state for the sidebar strip
  const [groups, setGroups] = useState<XpmGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

  async function loadFromDb() {
    const { data } = await supabase
      .from("xpm_groups")
      .select("xpm_uuid, name")
      .order("name", { ascending: true });
    return (data as XpmGroup[]) ?? [];
  }

  async function fetchFromXpm() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-xpm-groups");
      if (error) throw error;
      const fetchedGroups = (data?.groups ?? []) as XpmGroup[];
      setGroups(fetchedGroups);
      if (fetchedGroups.length > 0) toast.success(`${fetchedGroups.length} groups loaded`);
    } catch {
      toast.error("Failed to fetch groups");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      const cached = await loadFromDb();
      if (cached.length > 0) {
        setGroups(cached);
        setLoading(false);
        return;
      }
      setLoading(false);
      await fetchFromXpm();
    }
    init();
  }, []);

  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search],
  );

  // Resize handler
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleSelectGroup = (g: XpmGroup) => {
    setSelectedGroup(g);
  };

  // If no group selected, show the full cards view
  if (!selectedGroup) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
        <p className="text-sm text-muted-foreground">
          View your XPM client groups and explore their entity structures.
        </p>
        <XpmGroupCards onSelectGroup={handleSelectGroup} selectedGroupId={null} />
      </div>
    );
  }

  // Group selected — show canvas with collapsible sidebar
  const actualWidth = sidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6">
      {/* Sidebar */}
      <div
        className="relative flex flex-col border-r border-border/50 bg-card/50 shrink-0 overflow-hidden transition-[width] duration-200"
        style={{ width: actualWidth }}
      >
        {/* Toggle button */}
        <div className="flex items-center justify-end p-1.5 border-b border-border/30">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Collapsed: icon strip */}
        {sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5 px-1.5">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-8 rounded-lg mx-auto" />
              ))
            ) : (
              filtered.map((g) => (
                <Tooltip key={g.xpm_uuid} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleSelectGroup(g)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors mx-auto ${
                        selectedGroup.xpm_uuid === g.xpm_uuid
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Users className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {g.name}
                  </TooltipContent>
                </Tooltip>
              ))
            )}
          </div>
        )}

        {/* Expanded: full list */}
        {!sidebarCollapsed && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search + Refresh */}
            <div className="p-2.5 space-y-2 border-b border-border/30">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter groups..."
                    className="h-7 pl-7 text-[11px]"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={fetchFromXpm}
                  disabled={syncing}
                >
                  <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* Group list */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {filtered.map((g) => (
                <button
                  key={g.xpm_uuid}
                  onClick={() => handleSelectGroup(g)}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors ${
                    selectedGroup.xpm_uuid === g.xpm_uuid
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
              {filtered.length === 0 && groups.length > 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4">No matches</p>
              )}
            </div>
          </div>
        )}

        {/* Resize handle (only when expanded) */}
        {!sidebarCollapsed && (
          <div
            className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/20 transition-colors ${
              isResizing ? "bg-primary/30" : ""
            }`}
            onMouseDown={handleMouseDown}
          />
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 min-w-0">
        <GroupStructureViewer
          groupUuid={selectedGroup.xpm_uuid}
          groupName={selectedGroup.name}
          onClose={() => setSelectedGroup(null)}
        />
      </div>
    </div>
  );
}
