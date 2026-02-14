import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStructureData, useFilteredGraph } from "@/hooks/useStructureData";
import StructureGraph from "@/components/structure/StructureGraph";
import GraphControls from "@/components/structure/GraphControls";
import EntityDetailPanel from "@/components/structure/EntityDetailPanel";

export default function StructureView() {
  const { id } = useParams();
  const { entities, relationships, structureName, loading } = useStructureData(id);

  const [search, setSearch] = useState("");
  const [filterRelType, setFilterRelType] = useState("all");
  const [showFamily, setShowFamily] = useState(false);
  const [depth, setDepth] = useState(2);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

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
          />
        )}

        {selectedEntity && (
          <EntityDetailPanel
            entity={selectedEntity}
            relationships={relationships}
            allEntities={entities}
            onClose={() => setSelectedEntityId(null)}
            onSelectEntity={setSelectedEntityId}
          />
        )}
      </div>
    </div>
  );
}
