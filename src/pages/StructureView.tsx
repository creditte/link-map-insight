import { useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, LayoutGrid, Palette, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useStructureData, useFilteredGraph } from "@/hooks/useStructureData";
import StructureGraph, { type LayoutMode } from "@/components/structure/StructureGraph";
import GraphControls from "@/components/structure/GraphControls";
import EntityDetailPanel from "@/components/structure/EntityDetailPanel";
import RelationshipDetailPanel from "@/components/structure/RelationshipDetailPanel";
import RelationshipLegend from "@/components/structure/RelationshipLegend";
import ExportMenu from "@/components/structure/ExportMenu";

export default function StructureView() {
  const { id } = useParams();
  const { entities, relationships, structureName, loading, reload } = useStructureData(id);
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterRelType, setFilterRelType] = useState("all");
  const [showFamily, setShowFamily] = useState(false);
  const [depth, setDepth] = useState(2);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [autoLayoutTrigger, setAutoLayoutTrigger] = useState(0);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("balanced");
  const [pinnedNodeIds, setPinnedNodeIds] = useState<Set<string>>(new Set());

  const graphRef = useRef<HTMLDivElement>(null);

  const { visibleEntities, visibleRelationships } = useFilteredGraph(
    entities, relationships,
    { search, showFamily, filterRelType: filterRelType === "all" ? "" : filterRelType, depth, selectedEntityId }
  );

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
        <div className="ml-auto flex items-center gap-1">
          {/* Layout mode selector */}
          <Select value={layoutMode} onValueChange={(v) => { setLayoutMode(v as LayoutMode); setAutoLayoutTrigger((c) => c + 1); }}>
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="ownership">Ownership</SelectItem>
              <SelectItem value="control">Control</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAutoLayoutTrigger((c) => c + 1)}>
            <LayoutGrid className="h-3.5 w-3.5" /> Auto-layout
          </Button>

          {pinnedNodeIds.size > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setPinnedNodeIds(new Set()); toast({ title: "All pins cleared" }); }}>
              <Pin className="h-3.5 w-3.5" /> Clear pins ({pinnedNodeIds.size})
            </Button>
          )}

          <Button variant={showLegend ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={() => setShowLegend(!showLegend)}>
            <Palette className="h-3.5 w-3.5" /> Legend
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

      {/* Graph + Panel */}
      <div className="relative mt-3 flex-1 rounded-lg border bg-card overflow-hidden">
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
            layoutMode={layoutMode}
            pinnedNodeIds={pinnedNodeIds}
            onTogglePin={handleTogglePin}
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
            onClose={() => setSelectedEdgeId(null)}
            onUpdated={handleEntityUpdated}
          />
        )}
      </div>
    </div>
  );
}
