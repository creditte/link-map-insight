import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, Users, RefreshCw, AlertCircle, Plus, Settings, FileBox,
  Calendar, Trash2, Waypoints, Network, Loader2, ChevronRight, PenLine, Star, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import GroupStructureViewer from "@/components/structure/GroupStructureViewer";
import GroupSearchDropdown from "@/components/structure/GroupSearchDropdown";
import FavouriteGroups from "@/components/structure/FavouriteGroups";
import CreateStructureModal from "@/components/structure/CreateStructureModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbSeparator, BreadcrumbPage,
} from "@/components/ui/breadcrumb";
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

type Tab = "xpm" | "manual";
const MAX_FAVOURITES = 10;

export default function Structures() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = sessionStorage.getItem("structures_active_tab");
    return saved === "manual" ? "manual" : "xpm";
  });
  const [selectedGroup, setSelectedGroup] = useState<XpmGroup | null>(null);

  // Groups state
  const [groups, setGroups] = useState<XpmGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);


  // Favourite groups (persisted)
  const [favourites, setFavourites] = useState<XpmGroup[]>([]);
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(new Set());
  const [xpmSearch, setXpmSearch] = useState("");

  // Recent structures (persisted, most recently updated)
  const [recentStructures, setRecentStructures] = useState<ManualStructure[]>([]);

  // Manual structures state
  const [manualStructures, setManualStructures] = useState<ManualStructure[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManualStructure | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // XPM connected check
  const [xpmConnected, setXpmConnected] = useState<boolean | null>(null);

  // ── Load groups ──
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const { data: connInfo } = await supabase.rpc("get_xero_connection_info");
        setXpmConnected(connInfo !== null && connInfo !== "null");
      } catch {
        setXpmConnected(false);
      }
      const { data } = await supabase
        .from("xpm_groups")
        .select("xpm_uuid, name")
        .order("name", { ascending: true });
      const cached = (data as XpmGroup[]) ?? [];
      if (cached.length > 0) {
        setGroups(cached);
        setLoading(false);
        return;
      }
      setLoading(false);
      // Try fetching from XPM
      setSyncing(true);
      try {
        const { data: xpmData, error } = await supabase.functions.invoke("list-xpm-groups");
        if (error) throw error;
        const fetchedGroups = (xpmData?.groups ?? []) as XpmGroup[];
        setGroups(fetchedGroups);
        if (fetchedGroups.length > 0) toast.success(`${fetchedGroups.length} groups loaded`);
      } catch {
        toast.error("Failed to fetch groups");
      } finally {
        setSyncing(false);
      }
    }
    init();
  }, []);

  // ── Load favourites ──
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("favourite_groups")
      .select("group_xpm_uuid, group_name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_FAVOURITES)
      .then(({ data }) => {
        if (data) {
          const favs = data.map((d: any) => ({ xpm_uuid: d.group_xpm_uuid, name: d.group_name }));
          setFavourites(favs);
          setFavouriteIds(new Set(favs.map((f: XpmGroup) => f.xpm_uuid)));
        }
      });
  }, [user?.id]);

  // ── Load recent structures (most recently updated) ──
  useEffect(() => {
    if (!user?.id) return;
    async function loadRecent() {
      try {
        const { data: tenantId } = await supabase.rpc("get_user_tenant_id", { _user_id: user!.id });
        if (!tenantId) return;
        const { data: structures } = await supabase
          .from("structures")
          .select("id, name, created_at, updated_at")
          .eq("tenant_id", tenantId)
          .eq("is_scenario", false)
          .neq("source", "manual")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(10);
        if (!structures || structures.length === 0) return;
        const structureIds = structures.map((s) => s.id);
        const { data: entityLinks } = await supabase
          .from("structure_entities")
          .select("structure_id")
          .in("structure_id", structureIds);
        const countMap: Record<string, number> = {};
        for (const link of entityLinks ?? []) {
          countMap[link.structure_id] = (countMap[link.structure_id] || 0) + 1;
        }
        setRecentStructures(
          structures.map((s) => ({
            id: s.id,
            name: s.name,
            created_at: s.created_at,
            entity_count: countMap[s.id] || 0,
          }))
        );
      } catch (err) {
        console.error("[Structures] Failed to load recent structures:", err);
      }
    }
    loadRecent();
  }, [user?.id]);

  // Persist tab
  useEffect(() => {
    sessionStorage.setItem("structures_active_tab", activeTab);
  }, [activeTab]);

  // Load manual structures
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
      const { data: structures } = await supabase
        .from("structures")
        .select("id, name, created_at")
        .eq("tenant_id", tenantId)
        .eq("is_scenario", false)
        .eq("source", "manual")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!structures || structures.length === 0) {
        setManualStructures([]);
        return;
      }
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

  const filteredManual = useMemo(
    () => manualStructures.filter((s) => s.name.toLowerCase().includes(manualSearch.toLowerCase())),
    [manualStructures, manualSearch],
  );

  const filteredXpmGroups = useMemo(
    () => xpmSearch.trim()
      ? groups.filter((g) => g.name.toLowerCase().includes(xpmSearch.toLowerCase()))
      : groups,
    [groups, xpmSearch],
  );

  // ── Handlers ──
  const handleSelectGroup = useCallback((g: XpmGroup) => {
    setSelectedGroup(g);
  }, []);

  const handleToggleFavourite = useCallback(async (g: XpmGroup) => {
    if (!user?.id) return;
    const isFav = favouriteIds.has(g.xpm_uuid);
    if (isFav) {
      // Remove
      setFavourites((prev) => prev.filter((f) => f.xpm_uuid !== g.xpm_uuid));
      setFavouriteIds((prev) => {
        const next = new Set(prev);
        next.delete(g.xpm_uuid);
        return next;
      });
      await supabase
        .from("favourite_groups")
        .delete()
        .eq("user_id", user.id)
        .eq("group_xpm_uuid", g.xpm_uuid);
    } else {
      if (favourites.length >= MAX_FAVOURITES) {
        toast.error("Maximum 10 favourites allowed");
        return;
      }
      // Add
      setFavourites((prev) => [g, ...prev]);
      setFavouriteIds((prev) => new Set(prev).add(g.xpm_uuid));
      await supabase
        .from("favourite_groups")
        .insert({ user_id: user.id, group_xpm_uuid: g.xpm_uuid, group_name: g.name });
    }
  }, [user?.id, favouriteIds, favourites.length]);

  async function handleDeleteStructure() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("structures")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleteTarget.id);
      if (error) throw error;
      setManualStructures((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      toast.success("Structure deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete structure");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const handleImportToEditor = useCallback(async (group: XpmGroup) => {
    setImportingId(group.xpm_uuid);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("import-xpm-group", {
        body: { group_uuid: group.xpm_uuid, group_name: group.name },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      toast.success(`Imported ${data.entities_count} entities and ${data.relationships_count} relationships`);
      navigate(`/structures/${data.structure_id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to import group");
    } finally {
      setImportingId(null);
    }
  }, [navigate]);

  // ── Tab Bar ──
  const TabBar = () => (
    <div className="flex items-center gap-1 border-b border-border/50 mb-4">
      <button
        onClick={() => setActiveTab("xpm")}
        className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
          activeTab === "xpm" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
          activeTab === "manual" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        My Structures
        {activeTab === "manual" && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
        )}
      </button>
    </div>
  );

  // ═══════════════════════════════════════════════════
  // GROUP SELECTED → show breadcrumb + full-width canvas
  // ═══════════════════════════════════════════════════
  if (selectedGroup) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] -m-6">
        {/* Breadcrumb + heading */}
        <div className="px-6 pt-4 pb-3 border-b border-border/50 bg-card/50 space-y-1">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedGroup(null)}
                >
                  Structures
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-xs">{selectedGroup.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">{selectedGroup.name}</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => handleImportToEditor(selectedGroup)}
                  disabled={importingId === selectedGroup.xpm_uuid}
                >
                  {importingId === selectedGroup.xpm_uuid ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PenLine className="h-3.5 w-3.5" />
                  )}
                  Open in Editor
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import this group into an editable structure</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-h-0">
          <GroupStructureViewer
            groupUuid={selectedGroup.xpm_uuid}
            groupName={selectedGroup.name}
            onClose={() => setSelectedGroup(null)}
          />
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // NO GROUP SELECTED → tabs view
  // ═══════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
      <p className="text-sm text-muted-foreground">
        View your XPM client groups and manage your entity structures.
      </p>

      <TabBar />

      {/* XPM Structures tab */}
      {activeTab === "xpm" && (
        <div className="space-y-6">
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
            <>
              {/* Searchable dropdown */}
              <div className="flex items-center gap-2">
               <GroupSearchDropdown
                  groups={groups}
                  loading={loading || syncing}
                  favouriteIds={favouriteIds}
                  onSelect={handleSelectGroup}
                  onToggleFavourite={handleToggleFavourite}
                  onImport={handleImportToEditor}
                  selectedGroupId={selectedGroup?.xpm_uuid}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-[42px] px-3 gap-1.5 shrink-0"
                  onClick={async () => {
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
                  }}
                  disabled={syncing}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  <span className="text-xs">{syncing ? "Syncing…" : "Refresh"}</span>
                </Button>
              </div>

              {/* Favourite groups */}
              <FavouriteGroups
                groups={favourites}
                onSelect={handleSelectGroup}
                onRemove={handleToggleFavourite}
              />

              {/* Recent Structures */}
              {recentStructures.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Recent Structures
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
                    {recentStructures.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/structures/${s.id}`)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-left text-xs font-medium text-foreground hover:border-primary/40 hover:bg-accent/50 transition-colors"
                      >
                        <Waypoints className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <span className="truncate block">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground">{s.entity_count} entities</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* All groups list */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">All Groups</h3>
                    {groups.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {filteredXpmGroups.length === groups.length
                          ? groups.length
                          : `${filteredXpmGroups.length} / ${groups.length}`}
                      </Badge>
                    )}
                  </div>
                  {groups.length > 0 && (
                    <div className="relative w-48">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Filter groups..."
                        className="h-8 pl-8 text-xs"
                        value={xpmSearch}
                        onChange={(e) => setXpmSearch(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {loading || syncing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                  </div>
                ) : filteredXpmGroups.length === 0 && groups.length > 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No groups match your search.</p>
                ) : filteredXpmGroups.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Network className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">No groups synced yet. Click Refresh to load from XPM.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredXpmGroups.map((g) => {
                      const isFav = favouriteIds.has(g.xpm_uuid);
                      return (
                        <Card
                          key={g.xpm_uuid}
                          className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 group hover:bg-accent/30"
                          onClick={() => handleSelectGroup(g)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                                  <Network className="h-4 w-4 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1 pt-0.5">
                                  <p className="text-sm font-semibold truncate text-foreground">{g.name}</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">Client Group</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleImportToEditor(g);
                                      }}
                                      disabled={importingId === g.xpm_uuid}
                                    >
                                      {importingId === g.xpm_uuid ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <PenLine className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">Open in Editor</TooltipContent>
                                </Tooltip>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleFavourite(g);
                                  }}
                                  className={`p-1 rounded transition-colors ${
                                    isFav
                                      ? "text-amber-500 hover:text-amber-600"
                                      : "text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-amber-500"
                                  }`}
                                >
                                  <Star className={`h-3.5 w-3.5 ${isFav ? "fill-current" : ""}`} />
                                </button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* My Structures tab */}
      {activeTab === "manual" && (
        <div className="space-y-4">
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

          {manualLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          )}

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

          {!manualLoading && filteredManual.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredManual.map((s) => (
                <Card
                  key={s.id}
                  className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 relative group hover:bg-accent/30"
                  onClick={() => navigate(`/structures/${s.id}`)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                    className="absolute top-3 right-3 p-1 rounded-md opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all z-10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary shrink-0">
                        <Waypoints className="h-5 w-5 text-foreground" />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-sm font-semibold truncate text-foreground">{s.name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
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
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium border-muted-foreground/30 text-muted-foreground">
                        Manual
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this structure?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStructure}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
