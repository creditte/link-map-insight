import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, LayoutGrid, Palette, Pin, Eye, Maximize, RotateCcw, LinkIcon, Sparkles, MousePointer, Grid3x3, Copy, GitCompareArrows, MoreHorizontal, Camera, Download, Filter, Search, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useStructureData, useFilteredGraph } from "@/hooks/useStructureData";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useSnapshots, loadSnapshotData, type SnapshotData } from "@/hooks/useSnapshots";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { computeHealthScoreV2 } from "@/lib/structureScoring";
import { supabase } from "@/integrations/supabase/client";
import StructureGraph, { type LayoutMode, type LayoutStrategy } from "@/components/structure/StructureGraph";
import EntityDetailPanel from "@/components/structure/EntityDetailPanel";
import RelationshipDetailPanel from "@/components/structure/RelationshipDetailPanel";
import RelationshipLegend from "@/components/structure/RelationshipLegend";
import ExportMenu from "@/components/structure/ExportMenu";
import ExportBlockedBanner from "@/components/structure/ExportBlockedBanner";
import StructureHealthPanel from "@/components/structure/StructureHealthPanel";
import OnboardingTooltips from "@/components/structure/OnboardingTooltips";
import AiAssistantPanel from "@/components/structure/AiAssistantPanel";
import CanvasHealthBar from "@/components/structure/CanvasHealthBar";
import CanvasFixMode from "@/components/structure/CanvasFixMode";
import ReviewDiagramPanel from "@/components/structure/ReviewDiagramPanel";
import CreateSnapshotDialog from "@/components/structure/CreateSnapshotDialog";
import SnapshotSelector from "@/components/structure/SnapshotSelector";
import CreateScenarioDialog from "@/components/structure/CreateScenarioDialog";
import StructureContextMenu, { type ContextMenuState } from "@/components/structure/StructureContextMenu";
import AddEntityDialog from "@/components/structure/AddEntityDialog";
import CanvasHealthIndicator from "@/components/structure/CanvasHealthIndicator";
import RelationshipTypePicker from "@/components/structure/RelationshipTypePicker";
import { formatDistanceToNow } from "date-fns";
import type { Connection } from "@xyflow/react";

export type ViewMode = "ownership" | "control" | "full";

const RELATIONSHIP_TYPES = [
  "director", "shareholder", "beneficiary", "trustee",
  "appointer", "settlor", "partner", "spouse", "parent", "child",
];

/* Toolbar divider */
function ToolbarDivider() {
  return <div className="h-6 w-px bg-border mx-0.5 shrink-0 hidden sm:block" />;
}

export default function StructureView() {
  const { id } = useParams();
  const {
    entities, relationships, structureName, loading, reload, structureHealth,
    layoutMode: dbLayoutMode, nodePositions, setLayoutMode: setDbLayoutMode,
    saveNodePositions, clearNodePositions,
    isScenario, scenarioLabel, parentStructureId, parentStructureName,
  } = useStructureData(id);
  const { toast } = useToast();
  const { showOnboarding, dismiss: dismissOnboarding } = useOnboarding();
  const { snapshots, reload: reloadSnapshots } = useSnapshots(id);
  const { tenant } = useTenantSettings();

  const tenantDefaultView = (tenant?.export_default_view_mode as ViewMode) || "ownership";
  const [search, setSearch] = useState("");
  const [filterRelType, setFilterRelType] = useState("all");
  const [showFamily, setShowFamily] = useState(false);
  const [depth, setDepth] = useState(2);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [autoLayoutTrigger, setAutoLayoutTrigger] = useState(0);
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  const [layoutAlgo, setLayoutAlgo] = useState<LayoutMode>("balanced");
  const [pinnedNodeIds, setPinnedNodeIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>(tenantDefaultView);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [showFixMode, setShowFixMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showAddEntityDialog, setShowAddEntityDialog] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Manual drawing state
  const [searchParams, setSearchParams] = useSearchParams();
  const isNewManual = searchParams.get("new") === "manual";
  const [showNamingDialog, setShowNamingDialog] = useState(false);
  const [newStructureName, setNewStructureName] = useState("");
  const [hasBeenNamed, setHasBeenNamed] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string } | null>(null);

  // Detect if this is a manual (non-XPM) structure
  const isManualStructure = useMemo(() => {
    return entities.length === 0 || entities.every(e => e.xpm_uuid === null);
  }, [entities]);

  // Show naming dialog when first entity is about to be added on a new manual structure
  useEffect(() => {
    if (isNewManual && !hasBeenNamed && structureName === "Untitled Structure") {
      setShowNamingDialog(true);
    }
  }, [isNewManual, hasBeenNamed, structureName]);

  const handleSaveStructureName = useCallback(async () => {
    if (!newStructureName.trim() || !id) return;
    await supabase.from("structures").update({ name: newStructureName.trim() }).eq("id", id);
    setHasBeenNamed(true);
    setShowNamingDialog(false);
    setSearchParams({}, { replace: true });
    reload();
  }, [newStructureName, id, reload, setSearchParams]);

  // Create entity with a specific type directly (from context menu submenu)
  const handleAddEntityWithType = useCallback(async (entityType: string, flowPosition?: { x: number; y: number }) => {
    if (!tenantId || !id) return;
    const { data: entity, error } = await supabase
      .from("entities")
      .insert({ name: `New ${entityType === "smsf" ? "SMSF" : entityType.replace("trust_", "").replace(/^\w/, c => c.toUpperCase())}`, entity_type: entityType as any, tenant_id: tenantId, source: "manual" as any })
      .select("id")
      .single();
    if (error || !entity) {
      toast({ title: "Failed to create entity", description: error?.message, variant: "destructive" });
      return;
    }
    await supabase.from("structure_entities").insert({ structure_id: id, entity_id: entity.id, position_x: flowPosition?.x ?? null, position_y: flowPosition?.y ?? null });
    toast({ title: "Entity added" });
    setSelectedEntityId(entity.id);
    setSelectedEdgeId(null);
    reload();
  }, [tenantId, id, toast, reload]);

  // Handle drag-to-connect
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setPendingConnection({ source: connection.source, target: connection.target });
  }, []);

  const handleConfirmRelationship = useCallback(async (relationshipType: string) => {
    if (!pendingConnection || !tenantId || !id) return;
    const { data: rel, error } = await supabase.from("relationships").insert({
      from_entity_id: pendingConnection.source,
      to_entity_id: pendingConnection.target,
      relationship_type: relationshipType as any,
      tenant_id: tenantId,
      source: "manual" as any,
    }).select("id").single();
    if (error || !rel) {
      toast({ title: "Failed to create relationship", description: error?.message, variant: "destructive" });
    } else {
      await supabase.from("structure_relationships").insert({ structure_id: id, relationship_id: rel.id });
      toast({ title: "Relationship created" });
      reload();
    }
    setPendingConnection(null);
  }, [pendingConnection, tenantId, id, toast, reload]);

  // Edit entity = select it to open detail panel
  const handleEditEntity = useCallback((nodeId: string) => {
    setSelectedEntityId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  // Duplicate entity
  const handleDuplicateEntity = useCallback(async (nodeId: string) => {
    const entity = entities.find(e => e.id === nodeId);
    if (!entity || !tenantId || !id) return;
    const { data, error } = await supabase.from("entities")
      .insert({ name: `${entity.name} (copy)`, entity_type: entity.entity_type as any, tenant_id: tenantId, source: "manual" as any })
      .select("id").single();
    if (data) {
      await supabase.from("structure_entities").insert({ structure_id: id, entity_id: data.id });
      toast({ title: "Entity duplicated" });
      reload();
    }
  }, [entities, tenantId, id, toast, reload]);

  const healthV2 = useMemo(
    () => computeHealthScoreV2(entities, relationships),
    [entities, relationships]
  );

  const issueOverlays = useMemo(() => {
    if (!healthV2?.issues) return [];
    const overlays: Array<{ entityId: string; severity: "critical" | "warning"; tooltip: string }> = [];
    for (const issue of healthV2.issues) {
      if (!issue.entity_id || issue.severity === "info") continue;
      overlays.push({
        entityId: issue.entity_id,
        severity: issue.severity === "critical" ? "critical" : "warning",
        tooltip: issue.message,
      });
    }
    return overlays;
  }, [healthV2]);

  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [snapshotData, setSnapshotData] = useState<SnapshotData | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const graphRef = useRef<HTMLDivElement>(null);

  const isViewingSnapshot = !!activeSnapshotId && !!snapshotData;
  const activeSnapshot = snapshots.find((s) => s.id === activeSnapshotId);

  const displayEntities = isViewingSnapshot ? snapshotData.entities : entities;
  const displayRelationships = isViewingSnapshot ? snapshotData.relationships : relationships;
  const displayPositions = isViewingSnapshot ? snapshotData.positions : nodePositions;

  const { visibleEntities, visibleRelationships } = useFilteredGraph(
    displayEntities, displayRelationships,
    { search: "", showFamily, filterRelType: filterRelType === "all" ? "" : filterRelType, depth, selectedEntityId, viewMode }
  );

  const searchHighlightId = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    const match = visibleEntities.find((e) => e.name.toLowerCase().includes(q));
    return match?.id ?? null;
  }, [search, visibleEntities]);

  const selectedEntity = selectedEntityId ? displayEntities.find((e) => e.id === selectedEntityId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? displayRelationships.find((r) => r.id === selectedEdgeId) ?? null : null;

  // Last updated date from entities
  const lastUpdated = useMemo(() => {
    if (displayEntities.length === 0) return null;
    let latest = "";
    for (const e of displayEntities) {
      if (e.created_at && e.created_at > latest) latest = e.created_at;
    }
    if (!latest) return null;
    try { return formatDistanceToNow(new Date(latest), { addSuffix: true }); } catch { return null; }
  }, [displayEntities]);

  const handleEntityUpdated = useCallback(() => { reload(); }, [reload]);

  const handleTogglePin = useCallback((nodeId: string) => {
    if (isViewingSnapshot) return;
    setPinnedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        toast({ title: "Node unpinned" });
      } else {
        next.add(nodeId);
        toast({ title: "Node pinned", description: "Double-click again to unpin" });
      }
      return next;
    });
  }, [toast, isViewingSnapshot]);

  const handleResetFilters = useCallback(() => {
    setSearch("");
    setFilterRelType("all");
    setShowFamily(false);
    setDepth(2);
    setSelectedEntityId(null);
    setSelectedEdgeId(null);
    toast({ title: "Filters reset" });
  }, [toast]);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}/structures/${id}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Link copied", description: "Structure link copied to clipboard" });
    });
  }, [id, toast]);

  const handleSwitchToManual = useCallback(() => {
    setDbLayoutMode("manual");
    toast({ title: "Manual layout", description: "Drag nodes to arrange. Positions are saved for all users." });
  }, [setDbLayoutMode, toast]);

  const handleResetToAuto = useCallback(() => {
    clearNodePositions();
    setDbLayoutMode("auto");
    setAutoLayoutTrigger((c) => c + 1);
    toast({ title: "Auto layout restored" });
  }, [clearNodePositions, setDbLayoutMode, toast]);

  const handlePositionsChanged = useCallback((positions: Map<string, { x: number; y: number }>) => {
    saveNodePositions(positions);
  }, [saveNodePositions]);

  const handleViewSnapshot = useCallback(async (snapshotId: string) => {
    setSnapshotLoading(true);
    try {
      const data = await loadSnapshotData(snapshotId);
      setSnapshotData(data);
      setActiveSnapshotId(snapshotId);
      setSelectedEntityId(null);
      setSelectedEdgeId(null);
      setFitViewTrigger((c) => c + 1);
    } catch (e: any) {
      console.error("Failed to load snapshot:", e);
      toast({ title: "Failed to load snapshot", description: e.message, variant: "destructive" });
    } finally {
      setSnapshotLoading(false);
    }
  }, [toast]);

  const handleReturnToLive = useCallback(() => {
    setActiveSnapshotId(null);
    setSnapshotData(null);
    setSelectedEntityId(null);
    setSelectedEdgeId(null);
    setFitViewTrigger((c) => c + 1);
  }, []);

  useMemo(() => {
    if (!id) return;
    supabase.from("structures").select("tenant_id").eq("id", id).single().then(({ data }) => {
      if (data) setTenantId(data.tenant_id);
    });
  }, [id]);

  const handleContextMenu = useCallback((menu: ContextMenuState) => {
    if (isViewingSnapshot) return;
    setContextMenu(menu);
  }, [isViewingSnapshot]);

  const handleAddEntityFromMenu = useCallback(() => {
    setContextMenu(null);
    setShowAddEntityDialog(true);
  }, []);

  const handleAddRelationshipFromMenu = useCallback((nodeId: string) => {
    setContextMenu(null);
    setSelectedEntityId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  const handleRemoveEntity = useCallback(async (entityId: string) => {
    setContextMenu(null);
    const entity = entities.find((e) => e.id === entityId);
    if (!entity) return;
    const { error } = await supabase
      .from("entities")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", entityId);
    if (error) {
      toast({ title: "Failed to remove entity", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity removed", description: entity.name });
      setSelectedEntityId(null);
      reload();
    }
  }, [entities, toast, reload]);

  const handleRemoveRelationship = useCallback(async (relId: string) => {
    setContextMenu(null);
    const rel = relationships.find((r) => r.id === relId);
    const { error } = await supabase
      .from("relationships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", relId);
    if (error) {
      toast({ title: "Failed to remove relationship", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Relationship removed", description: rel?.relationship_type ?? "" });
      setSelectedEdgeId(null);
      reload();
    }
  }, [relationships, toast, reload]);

  if (loading || snapshotLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">{snapshotLoading ? "Loading snapshot..." : "Loading structure..."}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Snapshot banner */}
      {isViewingSnapshot && activeSnapshot && (
        <div className="flex items-center gap-3 px-3 py-2 bg-accent/50 border-b rounded-t-lg">
          <Badge variant="secondary" className="gap-1.5">
            Viewing snapshot: {activeSnapshot.name}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Created {new Date(activeSnapshot.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <span className="text-xs text-muted-foreground">•</span>
          <span className="text-xs text-muted-foreground">
            {snapshotData.entities.length} entities · {snapshotData.relationships.length} relationships
          </span>
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={handleReturnToLive}>
            ← Return to Live Structure
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-1 pb-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/structures"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">{structureName}</h1>
            {isScenario && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Copy className="h-3 w-3" /> Scenario
              </Badge>
            )}
            {isManualStructure && !isScenario && (
              <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                <PenTool className="h-2.5 w-2.5" /> Manual entry
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{displayEntities.length} entities · {displayRelationships.length} relationships</span>
            {lastUpdated && (
              <>
                <span>·</span>
                <span>Last updated {lastUpdated}</span>
              </>
            )}
          </div>
        </div>
        {isScenario && parentStructureId && parentStructureName && (
          <Link to={`/structures/${parentStructureId}`} className="text-xs text-muted-foreground hover:underline">
            Based on: {parentStructureName}
          </Link>
        )}
        {!isViewingSnapshot && dbLayoutMode === "manual" && (
          <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            Manual layout
          </span>
        )}

        {/* Toolbar — grouped with dividers */}
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {/* GROUP 1: View controls */}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <Eye className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ownership">Ownership</SelectItem>
              <SelectItem value="control">Control</SelectItem>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>

          {!isViewingSnapshot && (
            <>
              <Select value={layoutAlgo} onValueChange={(v) => { setLayoutAlgo(v as LayoutMode); setAutoLayoutTrigger((c) => c + 1); }}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="ownership">Ownership</SelectItem>
                  <SelectItem value="control">Control</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFitViewTrigger((c) => c + 1)}>
                <Maximize className="h-3.5 w-3.5" /> Fit View
              </Button>

              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleResetToAuto}>
                <LayoutGrid className="h-3.5 w-3.5" /> Reset to Auto
              </Button>

              <Button
                variant={dbLayoutMode === "manual" ? "secondary" : "outline"}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => dbLayoutMode === "auto" ? handleSwitchToManual() : handleResetToAuto()}
              >
                {dbLayoutMode === "manual" ? (
                  <><MousePointer className="h-3.5 w-3.5" /> Manual</>
                ) : (
                  <><Grid3x3 className="h-3.5 w-3.5" /> Auto</>
                )}
              </Button>

              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={handleResetFilters}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>

              {pinnedNodeIds.size > 0 && (
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setPinnedNodeIds(new Set()); toast({ title: "All pins cleared" }); }}>
                  <Pin className="h-3.5 w-3.5" /> Clear pins ({pinnedNodeIds.size})
                </Button>
              )}
            </>
          )}

          {isViewingSnapshot && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFitViewTrigger((c) => c + 1)}>
              <Maximize className="h-3.5 w-3.5" /> Fit View
            </Button>
          )}

          <ToolbarDivider />

          {/* GROUP 2: Output actions */}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleCopyLink}>
            <LinkIcon className="h-3.5 w-3.5" /> Copy link
          </Button>

          {!isViewingSnapshot && id && (
            <CreateSnapshotDialog
              structureId={id}
              structureName={structureName}
              onCreated={reloadSnapshots}
            />
          )}

          <SnapshotSelector
            snapshots={snapshots}
            activeSnapshotId={activeSnapshotId}
            onSelect={handleViewSnapshot}
            onReturnToLive={handleReturnToLive}
          />

          <ExportMenu
            graphRef={graphRef}
            entities={visibleEntities}
            relationships={visibleRelationships}
            structureName={structureName}
            snapshotName={activeSnapshot?.name}
            snapshotCreatedAt={activeSnapshot?.created_at}
            isScenario={isScenario}
            scenarioLabel={scenarioLabel ?? undefined}
            tenant={tenant}
            disabled={!!(tenant?.export_block_on_critical_health && structureHealth?.status === "critical" && !isViewingSnapshot)}
            healthV2={healthV2}
          />

          <ToolbarDivider />

          {/* GROUP 3: Advanced tools — visible on wide screens */}
          <div className="hidden xl:flex items-center gap-1">
            {!isViewingSnapshot && (
              <Button variant={showAiPanel ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowAiPanel(!showAiPanel)}>
                <Sparkles className="h-3.5 w-3.5" /> AI Assist
              </Button>
            )}

            {id && (isScenario || isViewingSnapshot) && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                <Link to={`/structures/${isScenario ? parentStructureId ?? id : id}/compare?right=${isViewingSnapshot ? `snapshot:${activeSnapshotId}` : `scenario:${id}`}`}>
                  <GitCompareArrows className="h-3.5 w-3.5" /> Compare
                </Link>
              </Button>
            )}
            {id && !isScenario && !isViewingSnapshot && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                <Link to={`/structures/${id}/compare`}>
                  <GitCompareArrows className="h-3.5 w-3.5" /> Compare
                </Link>
              </Button>
            )}

            {!isViewingSnapshot && id && (
              <CreateScenarioDialog
                sourceStructureId={id}
                structureName={structureName}
              />
            )}

            {isViewingSnapshot && activeSnapshotId && (
              <CreateScenarioDialog
                snapshotId={activeSnapshotId}
                structureName={activeSnapshot?.name ?? structureName}
                triggerLabel="Scenario from Snapshot"
              />
            )}

            <Button variant={showLegend ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowLegend(!showLegend)}>
              <Palette className="h-3.5 w-3.5" /> Legend
            </Button>
          </div>

          {/* GROUP 3: More dropdown — visible on narrow screens */}
          <div className="xl:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <MoreHorizontal className="h-3.5 w-3.5" /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isViewingSnapshot && (
                  <DropdownMenuItem onClick={() => setShowAiPanel(!showAiPanel)}>
                    <Sparkles className="h-3.5 w-3.5 mr-2" /> AI Assist
                  </DropdownMenuItem>
                )}
                {id && !isScenario && !isViewingSnapshot && (
                  <DropdownMenuItem asChild>
                    <Link to={`/structures/${id}/compare`} className="flex items-center">
                      <GitCompareArrows className="h-3.5 w-3.5 mr-2" /> Compare
                    </Link>
                  </DropdownMenuItem>
                )}
                {id && (isScenario || isViewingSnapshot) && (
                  <DropdownMenuItem asChild>
                    <Link
                      to={`/structures/${isScenario ? parentStructureId ?? id : id}/compare?right=${isViewingSnapshot ? `snapshot:${activeSnapshotId}` : `scenario:${id}`}`}
                      className="flex items-center"
                    >
                      <GitCompareArrows className="h-3.5 w-3.5 mr-2" /> Compare
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowLegend(!showLegend)}>
                  <Palette className="h-3.5 w-3.5 mr-2" /> Legend
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Search & Filters bar */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            className="pl-9 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Filter className="h-3.5 w-3.5" />
              Filters
              {(filterRelType !== "all" || showFamily || depth !== 2) && (
                <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {(filterRelType !== "all" ? 1 : 0) + (showFamily ? 1 : 0) + (depth !== 2 ? 1 : 0)}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Relationship type</Label>
              <Select value={filterRelType} onValueChange={setFilterRelType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All relationships" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All relationships</SelectItem>
                  {RELATIONSHIP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="filter-family" className="text-xs">Show family</Label>
              <Switch id="filter-family" checked={showFamily} onCheckedChange={setShowFamily} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Depth: {selectedEntityId ? depth : "–"}</Label>
              <Slider
                min={1} max={3} step={1}
                value={[depth]}
                onValueChange={([v]) => setDepth(v)}
                disabled={!selectedEntityId}
                className="w-full"
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Export blocked banner */}
      {!isViewingSnapshot && (
        <ExportBlockedBanner
          entities={entities}
          structureHealth={structureHealth}
          blockOnCritical={tenant?.export_block_on_critical_health}
        />
      )}

      {!isViewingSnapshot && (
        <StructureHealthPanel health={structureHealth} onSelectEntity={(eid) => { setSelectedEntityId(eid); setSelectedEdgeId(null); }} />
      )}

      {/* Graph + Panel */}
      <div className="relative mt-1 flex-1 rounded-lg border bg-card overflow-hidden">
        {showOnboarding && !isViewingSnapshot && <OnboardingTooltips onDismiss={dismissOnboarding} />}

        {/* Canvas Health Bar */}
        {!isViewingSnapshot && healthV2 && (
          <CanvasHealthBar
            health={healthV2}
            onFixIssues={() => { setShowFixMode(true); setShowReviewPanel(false); setShowAiPanel(false); }}
            onViewDetails={() => { setShowReviewPanel(true); setShowFixMode(false); setShowAiPanel(false); }}
          />
        )}

        {/* Health indicators */}
        {!isViewingSnapshot && healthV2 && (
          <CanvasHealthIndicator
            health={healthV2}
            onClick={() => { setShowReviewPanel(true); setShowFixMode(false); setShowAiPanel(false); }}
          />
        )}

        {/* Fix Mode overlay */}
        {showFixMode && !isViewingSnapshot && healthV2 && (
          <CanvasFixMode
            issues={healthV2.issues}
            entities={entities}
            structureName={structureName}
            onClose={() => setShowFixMode(false)}
            onFocusEntity={(eid) => { setSelectedEntityId(eid); setSelectedEdgeId(null); setFitViewTrigger((c) => c + 1); }}
            onEntityUpdated={handleEntityUpdated}
            onExport={() => {}}
          />
        )}

        {/* Review Diagram Panel */}
        {showReviewPanel && !isViewingSnapshot && !showFixMode && (
          <ReviewDiagramPanel
            health={healthV2}
            entities={visibleEntities}
            relationships={visibleRelationships}
            structureName={structureName}
            onClose={() => setShowReviewPanel(false)}
            onSelectEntity={(eid) => { setSelectedEntityId(eid); setSelectedEdgeId(null); }}
          />
        )}

        {showAiPanel && !isViewingSnapshot && !showReviewPanel && (
          <AiAssistantPanel
            entities={visibleEntities}
            relationships={visibleRelationships}
            structureName={structureName}
            onClose={() => setShowAiPanel(false)}
          />
        )}

        {/* Relationship type picker for drag-to-connect */}
        {pendingConnection && (
          <RelationshipTypePicker
            open={true}
            fromEntityName={entities.find(e => e.id === pendingConnection.source)?.name ?? "Entity"}
            toEntityName={entities.find(e => e.id === pendingConnection.target)?.name ?? "Entity"}
            onConfirm={handleConfirmRelationship}
            onCancel={() => setPendingConnection(null)}
          />
        )}

        {visibleEntities.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border-2 border-dashed border-border/60 px-10 py-12 text-center max-w-sm">
              <p className="text-sm text-muted-foreground">Right-click anywhere on the canvas to add your first entity.</p>
            </div>
          </div>
        ) : (
          <StructureGraph
            ref={graphRef}
            entities={visibleEntities}
            relationships={visibleRelationships}
            selectedEntityId={selectedEntityId}
            onSelectEntity={setSelectedEntityId}
            onSelectEdge={setSelectedEdgeId}
            autoLayoutTrigger={autoLayoutTrigger}
            layoutMode={layoutAlgo}
            layoutStrategy={isViewingSnapshot ? "manual" : dbLayoutMode}
            pinnedNodeIds={isViewingSnapshot ? new Set() : pinnedNodeIds}
            onTogglePin={handleTogglePin}
            viewMode={viewMode}
            searchHighlightId={searchHighlightId}
            fitViewTrigger={fitViewTrigger}
            dbPositions={displayPositions}
            onPositionsChanged={isViewingSnapshot ? () => {} : handlePositionsChanged}
            nodesDraggable={!isViewingSnapshot && dbLayoutMode === "manual"}
            onContextMenu={handleContextMenu}
            issueOverlays={issueOverlays}
            onConnect={handleConnect}
          />
        )}

        <RelationshipLegend visible={showLegend} onToggle={() => setShowLegend(!showLegend)} />

        {selectedEntity && !selectedEdgeId && !isViewingSnapshot && (
          <EntityDetailPanel
            entity={selectedEntity}
            relationships={relationships}
            allEntities={entities}
            structureId={id!}
            onClose={() => setSelectedEntityId(null)}
            onSelectEntity={setSelectedEntityId}
            onEntityUpdated={handleEntityUpdated}
          />
        )}

        {selectedRelationship && !isViewingSnapshot && (
          <RelationshipDetailPanel
            relationship={selectedRelationship}
            allEntities={entities}
            allRelationships={relationships}
            onClose={() => setSelectedEdgeId(null)}
            onUpdated={handleEntityUpdated}
          />
        )}

        {contextMenu && !isViewingSnapshot && (
          <StructureContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onAddEntity={handleAddEntityFromMenu}
            onAddEntityWithType={handleAddEntityWithType}
            onAddRelationship={handleAddRelationshipFromMenu}
            onRemoveEntity={handleRemoveEntity}
            onRemoveRelationship={handleRemoveRelationship}
            onEditEntity={handleEditEntity}
            onDuplicateEntity={handleDuplicateEntity}
          />
        )}
      </div>

      {/* Naming dialog for new manual structures */}
      <Dialog open={showNamingDialog} onOpenChange={setShowNamingDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Name your structure</DialogTitle>
          </DialogHeader>
          <Input
            value={newStructureName}
            onChange={(e) => setNewStructureName(e.target.value)}
            placeholder="e.g. Smith Family Group"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && newStructureName.trim() && handleSaveStructureName()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNamingDialog(false); setSearchParams({}, { replace: true }); }}>Skip</Button>
            <Button onClick={handleSaveStructureName} disabled={!newStructureName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tenantId && id && (
        <AddEntityDialog
          open={showAddEntityDialog}
          onOpenChange={setShowAddEntityDialog}
          structureId={id}
          tenantId={tenantId}
          onEntityCreated={handleEntityUpdated}
        />
      )}
    </div>
  );
}
