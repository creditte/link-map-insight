import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Copy, PenTool, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import CanvasFixMode from "@/components/structure/CanvasFixMode";
import ReviewDiagramPanel from "@/components/structure/ReviewDiagramPanel";
import CreateSnapshotDialog from "@/components/structure/CreateSnapshotDialog";
import SnapshotSelector from "@/components/structure/SnapshotSelector";
import CreateScenarioDialog from "@/components/structure/CreateScenarioDialog";
import StructureContextMenu, { type ContextMenuState } from "@/components/structure/StructureContextMenu";
import AddEntityDialog from "@/components/structure/AddEntityDialog";
import RelationshipTypePicker from "@/components/structure/RelationshipTypePicker";
import CanvasHealthBadge from "@/components/structure/CanvasHealthBadge";
import FloatingActions from "@/components/structure/FloatingActions";
import SecondaryActionsMenu from "@/components/structure/SecondaryActionsMenu";
import CanvasCommandBar from "@/components/structure/CanvasCommandBar";
import { formatDistanceToNow } from "date-fns";
import type { Connection } from "@xyflow/react";

export type ViewMode = "ownership" | "control" | "full";

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
  const [showCommandBar, setShowCommandBar] = useState(false);

  // Manual drawing state
  const [searchParams, setSearchParams] = useSearchParams();
  const isNewManual = searchParams.get("new") === "manual";
  const [showNamingDialog, setShowNamingDialog] = useState(false);
  const [newStructureName, setNewStructureName] = useState("");
  const [hasBeenNamed, setHasBeenNamed] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string } | null>(null);

  const isManualStructure = useMemo(() => {
    return entities.length === 0 || entities.every(e => e.xpm_uuid === null);
  }, [entities]);

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

  const handleEditEntity = useCallback((nodeId: string) => {
    setSelectedEntityId(nodeId);
    setSelectedEdgeId(null);
  }, []);

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

  const searchHighlightId = useMemo(() => null, []);

  const selectedEntity = selectedEntityId ? displayEntities.find((e) => e.id === selectedEntityId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? displayRelationships.find((r) => r.id === selectedEdgeId) ?? null : null;

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
      <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <Skeleton className="flex-1 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Snapshot banner */}
      {isViewingSnapshot && activeSnapshot && (
        <div className="flex items-center gap-3 px-3 py-2 bg-accent/50 border-b">
          <Badge variant="secondary" className="gap-1.5">
            Viewing snapshot: {activeSnapshot.name}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Created {new Date(activeSnapshot.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={handleReturnToLive}>
            ← Return to Live
          </Button>
        </div>
      )}

      {/* Breadcrumb + identity bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-background">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Link to="/structures" className="hover:text-foreground transition-colors">Structures</Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground font-medium truncate max-w-[200px]">{structureName}</span>
        </nav>

        <div className="flex items-center gap-2 ml-1">
            {isScenario && (
              <Badge variant="secondary" className="gap-1 text-[10px] shrink-0">
                <Copy className="h-2.5 w-2.5" /> Scenario
              </Badge>
            )}
            {isManualStructure && !isScenario && (
              <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground shrink-0">
                <PenTool className="h-2.5 w-2.5" /> Manual
              </Badge>
            )}
        </div>

        <span className="text-[11px] text-muted-foreground ml-1">
          {displayEntities.length} entities · {displayRelationships.length} relationships
          {lastUpdated && <> · Updated {lastUpdated}</>}
        </span>

        {isScenario && parentStructureId && parentStructureName && (
          <Link to={`/structures/${parentStructureId}`} className="text-[11px] text-muted-foreground hover:underline shrink-0">
            Based on: {parentStructureName}
          </Link>
        )}

        {!isViewingSnapshot && dbLayoutMode === "manual" && (
          <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground shrink-0">
            Manual layout
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* Snapshot selector + create */}
          {!isViewingSnapshot && id && (
            <CreateSnapshotDialog structureId={id} structureName={structureName} onCreated={reloadSnapshots} />
          )}
          <SnapshotSelector
            snapshots={snapshots}
            activeSnapshotId={activeSnapshotId}
            onSelect={handleViewSnapshot}
            onReturnToLive={handleReturnToLive}
          />

          {/* Export */}
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

          {/* Scenario create */}
          {!isViewingSnapshot && id && (
            <CreateScenarioDialog sourceStructureId={id} structureName={structureName} />
          )}
          {isViewingSnapshot && activeSnapshotId && (
            <CreateScenarioDialog snapshotId={activeSnapshotId} structureName={activeSnapshot?.name ?? structureName} triggerLabel="Scenario from Snapshot" />
          )}

          {/* AI Review button */}
          {!isViewingSnapshot && healthV2 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => { setShowReviewPanel(true); setShowFixMode(false); setShowAiPanel(false); }}
            >
              <HeartPulse className="h-3.5 w-3.5" />
              AI Review
            </Button>
          )}

          {/* Secondary actions ••• */}
          <SecondaryActionsMenu
            structureId={id!}
            structureName={structureName}
            viewMode={viewMode}
            onViewModeChange={(v) => setViewMode(v)}
            layoutAlgo={layoutAlgo}
            onLayoutAlgoChange={(v) => { setLayoutAlgo(v); setAutoLayoutTrigger((c) => c + 1); }}
            dbLayoutMode={dbLayoutMode}
            onSwitchToManual={handleSwitchToManual}
            onResetToAuto={handleResetToAuto}
            onFitView={() => setFitViewTrigger((c) => c + 1)}
            onResetFilters={handleResetFilters}
            onCopyLink={handleCopyLink}
            onToggleLegend={() => setShowLegend(!showLegend)}
            showLegend={showLegend}
            onOpenSearch={() => setShowCommandBar(true)}
            isScenario={isScenario}
            parentStructureId={parentStructureId}
            isViewingSnapshot={isViewingSnapshot}
            activeSnapshotId={activeSnapshotId}
            snapshots={snapshots}
            onViewSnapshot={handleViewSnapshot}
            onReturnToLive={handleReturnToLive}
            reloadSnapshots={reloadSnapshots}
            pinnedCount={pinnedNodeIds.size}
            onClearPins={() => { setPinnedNodeIds(new Set()); toast({ title: "All pins cleared" }); }}
            graphRef={graphRef}
            entities={visibleEntities}
            relationships={visibleRelationships}
            tenant={tenant}
            healthV2={healthV2}
            structureHealth={structureHealth}
            scenarioLabel={scenarioLabel ?? undefined}
            activeSnapshot={activeSnapshot}
          />
        </div>
      </div>

      {/* Export blocked banner */}
      {!isViewingSnapshot && (
        <ExportBlockedBanner
          entities={entities}
          structureHealth={structureHealth}
          blockOnCritical={tenant?.export_block_on_critical_health}
        />
      )}

      {/* Canvas — maximum space */}
      <div className="relative flex-1 overflow-hidden">
        {showOnboarding && !isViewingSnapshot && <OnboardingTooltips onDismiss={dismissOnboarding} />}

        {/* Health badge (small, top-right) */}
        {!isViewingSnapshot && healthV2 && (
          <CanvasHealthBadge
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
            structureId={id}
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
            fromEntityType={entities.find(e => e.id === pendingConnection.source)?.entity_type}
            toEntityType={entities.find(e => e.id === pendingConnection.target)?.entity_type}
            onConfirm={handleConfirmRelationship}
            onCancel={() => setPendingConnection(null)}
          />
        )}

        {visibleEntities.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-muted/20">
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

        {/* Floating actions — bottom right */}
        {!isViewingSnapshot && (
          <FloatingActions
            onAddEntity={() => setShowAddEntityDialog(true)}
            onAiAssist={() => setShowAiPanel(!showAiPanel)}
            showAiPanel={showAiPanel}
          />
        )}

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

      {/* Command bar (⌘K search) */}
      <CanvasCommandBar
        open={showCommandBar}
        onOpenChange={setShowCommandBar}
        entities={displayEntities}
        onSelectEntity={(eid) => { setSelectedEntityId(eid); setSelectedEdgeId(null); setFitViewTrigger((c) => c + 1); }}
      />

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
