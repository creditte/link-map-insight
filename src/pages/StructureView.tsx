import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, LayoutGrid, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStructureData, useFilteredGraph } from "@/hooks/useStructureData";
import StructureGraph from "@/components/structure/StructureGraph";
import GraphControls from "@/components/structure/GraphControls";
import EntityDetailPanel from "@/components/structure/EntityDetailPanel";
import RelationshipDetailPanel from "@/components/structure/RelationshipDetailPanel";
import RelationshipLegend from "@/components/structure/RelationshipLegend";

export default function StructureView() {
  const { id } = useParams();
  const { entities, relationships, structureName, loading, reload } = useStructureData(id);

  const [search, setSearch] = useState("");
  const [filterRelType, setFilterRelType] = useState("all");
  const [showFamily, setShowFamily] = useState(false);
  const [depth, setDepth] = useState(2);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [autoLayoutTrigger, setAutoLayoutTrigger] = useState(0);

  const { visibleEntities, visibleRelationships } = useFilteredGraph(
    entities,
    relationships,
    {
      search,
      showFamily,
      filterRelType: filterRelType === "all" ? "" : filterRelType,
      depth,
      selectedEntityId,
    }
  );

  const selectedEntity = selectedEntityId
    ? entities.find((e) => e.id === selectedEntityId) ?? null
    : null;

  const selectedRelationship = selectedEdgeId
    ? relationships.find((r) => r.id === selectedEdgeId) ?? null
    : null;

  const handleEntityUpdated = useCallback(() => {
    reload();
  }, [reload]);

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
          <Link to="/structures">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-bold tracking-tight">{structureName}</h1>
        <span className="text-xs text-muted-foreground">
          {entities.length} entities · {relationships.length} relationships
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setAutoLayoutTrigger((c) => c + 1)}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Auto-layout
          </Button>
          <Button
            variant={showLegend ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowLegend(!showLegend)}
          >
            <Palette className="h-3.5 w-3.5" />
            Legend
          </Button>
        </div>
      </div>

      {/* Controls */}
      <GraphControls
        search={search}
        onSearchChange={setSearch}
        filterRelType={filterRelType}
        onFilterRelTypeChange={setFilterRelType}
        showFamily={showFamily}
        onShowFamilyChange={setShowFamily}
        depth={depth}
        onDepthChange={setDepth}
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
            entities={visibleEntities}
            relationships={visibleRelationships}
            selectedEntityId={selectedEntityId}
            onSelectEntity={setSelectedEntityId}
            onSelectEdge={setSelectedEdgeId}
            autoLayoutTrigger={autoLayoutTrigger}
          />
        )}

        <RelationshipLegend visible={showLegend} onToggle={() => setShowLegend(!showLegend)} />

        {selectedEntity && !selectedEdgeId && (
          <EntityDetailPanel
            entity={selectedEntity}
            relationships={relationships}
            allEntities={entities}
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
