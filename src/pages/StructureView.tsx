import { useState, useCallback, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, LayoutGrid, Palette, Pin, Eye, Maximize, RotateCcw, LinkIcon, Sparkles, MousePointer, Grid3x3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useStructureData, useFilteredGraph } from "@/hooks/useStructureData";
import { useOnboarding } from "@/hooks/useOnboarding";
import StructureGraph, { type LayoutMode, type LayoutStrategy } from "@/components/structure/StructureGraph";
import GraphControls from "@/components/structure/GraphControls";
import EntityDetailPanel from "@/components/structure/EntityDetailPanel";
import RelationshipDetailPanel from "@/components/structure/RelationshipDetailPanel";
import RelationshipLegend from "@/components/structure/RelationshipLegend";
import ExportMenu from "@/components/structure/ExportMenu";
import ExportBlockedBanner from "@/components/structure/ExportBlockedBanner";
import StructureHealthPanel from "@/components/structure/StructureHealthPanel";
import OnboardingTooltips from "@/components/structure/OnboardingTooltips";
import AiAssistantPanel from "@/components/structure/AiAssistantPanel";

export type ViewMode = "ownership" | "control" | "full";

export default function StructureView() {
  const { id } = useParams();
  const {
    entities, relationships, structureName, loading, reload, structureHealth,
    layoutMode: dbLayoutMode, nodePositions, setLayoutMode: setDbLayoutMode,
    saveNodePositions, clearNodePositions,
  } = useStructureData(id);
  const { toast } = useToast();
  const { showOnboarding, dismiss: dismissOnboarding } = useOnboarding();

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
  const [viewMode, setViewMode] = useState<ViewMode>("ownership");
  const [showAiPanel, setShowAiPanel] = useState(false);

  const graphRef = useRef<HTMLDivElement>(null);

  const { visibleEntities, visibleRelationships } = useFilteredGraph(
    entities, relationships,
    { search: "", showFamily, filterRelType: filterRelType === "all" ? "" : filterRelType, depth, selectedEntityId, viewMode }
  );

  const searchHighlightId = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    const match = visibleEntities.find((e) => e.name.toLowerCase().includes(q));
    return match?.id ?? null;
  }, [search, visibleEntities]);

  const selectedEntity = selectedEntityId ? entities.find((e) => e.id === selectedEntityId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? relationships.find((r) => r.id === selectedEdgeId) ?? null : null;

  const handleEntityUpdated = useCallback(() => { reload(); }, [reload]);

  const handleTogglePin = useCallback((nodeId: string) => {
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
  }, [toast]);

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

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading structure...</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-1 pb-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/structures"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-lg font-bold tracking-tight">{structureName}</h1>
        <span className="text-xs text-muted-foreground">
          {entities.length} entities · {relationships.length} relationships
        </span>
        {dbLayoutMode === "manual" && (
          <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            Manual layout
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* View mode selector */}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <Eye className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ownership">Ownership</SelectItem>
              <SelectItem value="control">Control</SelectItem>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>

          {/* Layout algorithm selector */}
          <Select value={layoutAlgo} onValueChange={(v) => { setLayoutAlgo(v as LayoutMode); setAutoLayoutTrigger((c) => c + 1); }}>
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="ownership">Ownership</SelectItem>
              <SelectItem value="control">Control</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFitViewTrigger((c) => c + 1)}>
            <Maximize className="h-3.5 w-3.5" /> Fit View
          </Button>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleResetToAuto}>
            <LayoutGrid className="h-3.5 w-3.5" /> Reset to Auto
          </Button>

          <Button
            variant={dbLayoutMode === "manual" ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => dbLayoutMode === "auto" ? handleSwitchToManual() : handleResetToAuto()}
          >
            {dbLayoutMode === "manual" ? (
              <><MousePointer className="h-3.5 w-3.5" /> Manual</>
            ) : (
              <><Grid3x3 className="h-3.5 w-3.5" /> Auto</>
            )}
          </Button>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleResetFilters}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>

          {pinnedNodeIds.size > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setPinnedNodeIds(new Set()); toast({ title: "All pins cleared" }); }}>
              <Pin className="h-3.5 w-3.5" /> Clear pins ({pinnedNodeIds.size})
            </Button>
          )}

          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyLink}>
            <LinkIcon className="h-3.5 w-3.5" /> Copy link
          </Button>

          <Button variant={showLegend ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={() => setShowLegend(!showLegend)}>
            <Palette className="h-3.5 w-3.5" /> Legend
          </Button>

          <Button variant={showAiPanel ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={() => setShowAiPanel(!showAiPanel)}>
            <Sparkles className="h-3.5 w-3.5" /> AI Assist
          </Button>

          <ExportMenu
            graphRef={graphRef}
            entities={visibleEntities}
            relationships={visibleRelationships}
            structureName={structureName}
          />
        </div>
      </div>

      {/* Controls */}
      <GraphControls
        search={search} onSearchChange={setSearch}
        filterRelType={filterRelType} onFilterRelTypeChange={setFilterRelType}
        showFamily={showFamily} onShowFamilyChange={setShowFamily}
        depth={depth} onDepthChange={setDepth}
        hasSelection={!!selectedEntityId}
      />

      {/* Export blocked banner */}
      <ExportBlockedBanner entities={entities} />

      <StructureHealthPanel health={structureHealth} onSelectEntity={(eid) => { setSelectedEntityId(eid); setSelectedEdgeId(null); }} />

      {/* Graph + Panel */}
      <div className="relative mt-3 flex-1 rounded-lg border bg-card overflow-hidden">
        {showOnboarding && <OnboardingTooltips onDismiss={dismissOnboarding} />}

        {showAiPanel && (
          <AiAssistantPanel
            entities={visibleEntities}
            relationships={visibleRelationships}
            structureName={structureName}
            onClose={() => setShowAiPanel(false)}
          />
        )}
        {visibleEntities.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No entities to display.</p>
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
            layoutStrategy={dbLayoutMode}
            pinnedNodeIds={pinnedNodeIds}
            onTogglePin={handleTogglePin}
            viewMode={viewMode}
            searchHighlightId={searchHighlightId}
            fitViewTrigger={fitViewTrigger}
            dbPositions={nodePositions}
            onPositionsChanged={handlePositionsChanged}
          />
        )}

        <RelationshipLegend visible={showLegend} onToggle={() => setShowLegend(!showLegend)} />

        {selectedEntity && !selectedEdgeId && (
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

        {selectedRelationship && (
          <RelationshipDetailPanel
            relationship={selectedRelationship}
            allEntities={entities}
            allRelationships={relationships}
            onClose={() => setSelectedEdgeId(null)}
            onUpdated={handleEntityUpdated}
          />
        )}
      </div>
    </div>
  );
}
