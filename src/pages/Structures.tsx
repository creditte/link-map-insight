import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Users, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, PenLine, Loader2, Plus, Settings, FileBox, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import GroupStructureViewer from "@/components/structure/GroupStructureViewer";
import XpmGroupCards from "@/components/structure/XpmGroupCards";
import CreateStructureModal from "@/components/structure/CreateStructureModal";
import { useAuth } from "@/hooks/useAuth";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

interface ManualStructure {
  id: string;
  name: string;
  created_at: string;
  entity_count: number;
}

const COLLAPSED_WIDTH = 52;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;

type Tab = "xpm" | "manual";

export default function Structures() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("xpm");
  const [selectedGroup, setSelectedGroup] = useState<XpmGroup | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // Groups state for the sidebar strip
  const [groups, setGroups] = useState<XpmGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

  // Manual structures state
  const [manualStructures, setManualStructures] = useState<ManualStructure[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Check if XPM is connected
  const [xpmConnected, setXpmConnected] = useState<boolean | null>(null);

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
      // Check XPM connection
      try {
        const { data: connInfo } = await supabase.rpc("get_xero_connection_info");
        setXpmConnected(connInfo !== null && connInfo !== "null");
      } catch {
        setXpmConnected(false);
      }

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

  // Load manual structures when tab is selected
  useEffect(() => {
    if (activeTab !== "manual" || !user?.id) return;
    loadManualStructures();
  }, [activeTab, user?.id]);

  async function loadManualStructures() {
    if (!user?.id) return;
    setManualLoading(true);
    try {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user.id });
      if (!tenantId) return;

      // Get structures that are NOT scenarios and NOT deleted
      const { data: structures } = await supabase
        .from("structures")
        .select("id, name, created_at")
        .eq("tenant_id", tenantId)
        .eq("is_scenario", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (!structures || structures.length === 0) {
        setManualStructures([]);
        return;
      }

      // Get entity counts for each structure
      const structureIds = structures.map((s) => s.id);
      const { data: entityLinks } = await supabase
        .from("structure_entities")
        .select("structure_id")
        .in("structure_id", structureIds);

      const countMap: Record<string, number> = {};
      for (const link of entityLinks ?? []) {
        countMap[link.structure_id] = (countMap[link.structure_id] || 0) + 1;
      }

      setManualStructures(
        structures.map((s) => ({
          id: s.id,
          name: s.name,
          created_at: s.created_at,
          entity_count: countMap[s.id] || 0,
        }))
      );
    } catch (err) {
      console.error("[Structures] Failed to load manual structures:", err);
    } finally {
      setManualLoading(false);
    }
  }

  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search],
  );

  const filteredManual = useMemo(
    () => manualStructures.filter((s) => s.name.toLowerCase().includes(manualSearch.toLowerCase())),
    [manualStructures, manualSearch],
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

  async function handleImportToEditor(e: React.MouseEvent, group: XpmGroup) {
    e.stopPropagation();
    setImportingId(group.xpm_uuid);
    try {
      const { data, error } = await supabase.functions.invoke("import-xpm-group", {
        body: { group_uuid: group.xpm_uuid, group_name: group.name },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Imported ${data.entities_count} entities and ${data.relationships_count} relationships`);
      navigate(`/structures/${data.structure_id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to import group");
    } finally {
      setImportingId(null);
    }
  }

  // Tab component
  const TabBar = () => (
    <div className="flex items-center gap-1 border-b border-border/50 mb-4">
      <button
        onClick={() => setActiveTab("xpm")}
        className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
          activeTab === "xpm"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        XPM Structures
        {activeTab === "xpm" && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
        )}
      </button>
      <button
        onClick={() => setActiveTab("manual")}
        className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
          activeTab === "manual"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        My Structures
        {activeTab === "manual" && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
        )}
      </button>
    </div>
  );

  // If a group is selected, show canvas with sidebar (same as before)
  if (selectedGroup) {
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
                  <div
                    key={g.xpm_uuid}
                    onClick={() => handleSelectGroup(g)}
                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors cursor-pointer ${
                      selectedGroup.xpm_uuid === g.xpm_uuid
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">{g.name}</span>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => handleImportToEditor(e, g)}
                          disabled={importingId === g.xpm_uuid}
                          className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                        >
                          {importingId === g.xpm_uuid ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <PenLine className="h-3 w-3" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="text-xs">
                        Open in Editor
                      </TooltipContent>
                    </Tooltip>
                  </div>
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

  // No group selected — show tabs view
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
      <p className="text-sm text-muted-foreground">
        View your XPM client groups and manage your entity structures.
      </p>

      <TabBar />

      {/* XPM Structures tab */}
      {activeTab === "xpm" && (
        <>
          {xpmConnected === false && groups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Settings className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">XPM not connected</p>
              <p className="text-xs mt-1 max-w-sm mx-auto">
                Connect your Xero Practice Manager account in Settings to sync your structures.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => navigate("/settings")}
              >
                <Settings className="h-3.5 w-3.5" />
                Go to Settings
              </Button>
            </div>
          ) : (
            <XpmGroupCards onSelectGroup={handleSelectGroup} selectedGroupId={null} />
          )}
        </>
      )}

      {/* My Structures tab */}
      {activeTab === "manual" && (
        <div className="space-y-4">
          {/* Header with search and create button */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">My Structures</h2>
              {manualStructures.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {manualStructures.length}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {manualStructures.length > 0 && (
                <div className="relative w-48">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter structures..."
                    className="h-8 pl-8 text-xs"
                    value={manualSearch}
                    onChange={(e) => setManualSearch(e.target.value)}
                  />
                </div>
              )}
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Structure
              </Button>
            </div>
          </div>

          {/* Loading state */}
          {manualLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!manualLoading && manualStructures.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <FileBox className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">You haven't created any structures yet</p>
              <p className="text-xs mt-1">Create your first structure to start mapping entities and relationships.</p>
              <Button
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Structure
              </Button>
            </div>
          )}

          {/* Structure cards */}
          {!manualLoading && filteredManual.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredManual.map((s) => (
                <Card
                  key={s.id}
                  className="cursor-pointer transition-all hover:bg-accent/50"
                  onClick={() => navigate(`/structures/${s.id}`)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        <PenLine className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Users className="h-3 w-3" />
                            {s.entity_count} {s.entity_count === 1 ? "entity" : "entities"}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(s.created_at), "d MMM yyyy")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No search results */}
          {!manualLoading && filteredManual.length === 0 && manualStructures.length > 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No structures match your search.</p>
          )}
        </div>
      )}

      <CreateStructureModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onImportXpm={() => setActiveTab("xpm")}
      />
    </div>
  );
}
