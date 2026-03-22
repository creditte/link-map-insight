import { Link } from "react-router-dom";
import {
  MoreHorizontal, GitCompareArrows, Palette, LayoutGrid, Grid3x3, MousePointer,
  Maximize, RotateCcw, LinkIcon, Camera, Download, Eye, Search, Pin, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import ExportMenu from "./ExportMenu";
import CreateSnapshotDialog from "./CreateSnapshotDialog";
import CreateScenarioDialog from "./CreateScenarioDialog";
import SnapshotSelector from "./SnapshotSelector";
import type { ViewMode } from "@/pages/StructureView";
import type { LayoutMode } from "./StructureGraph";
import type { HealthScoreV2 } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

interface Props {
  structureId: string;
  structureName: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  layoutAlgo: LayoutMode;
  onLayoutAlgoChange: (mode: LayoutMode) => void;
  dbLayoutMode: "auto" | "manual";
  onSwitchToManual: () => void;
  onResetToAuto: () => void;
  onFitView: () => void;
  onResetFilters: () => void;
  onCopyLink: () => void;
  onToggleLegend: () => void;
  showLegend: boolean;
  onOpenSearch: () => void;
  isScenario: boolean;
  parentStructureId: string | null;
  isViewingSnapshot: boolean;
  activeSnapshotId: string | null;
  snapshots: any[];
  onViewSnapshot: (id: string) => void;
  onReturnToLive: () => void;
  reloadSnapshots: () => void;
  pinnedCount: number;
  onClearPins: () => void;
  // Export props
  graphRef: React.RefObject<HTMLDivElement>;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  tenant: any;
  healthV2: HealthScoreV2 | null;
  structureHealth: any;
  scenarioLabel?: string;
  activeSnapshot?: any;
}

export default function SecondaryActionsMenu(props: Props) {
  const {
    structureId, structureName, viewMode, onViewModeChange, layoutAlgo, onLayoutAlgoChange,
    dbLayoutMode, onSwitchToManual, onResetToAuto, onFitView, onResetFilters, onCopyLink,
    onToggleLegend, showLegend, onOpenSearch, isScenario, parentStructureId, isViewingSnapshot,
    activeSnapshotId, snapshots, onViewSnapshot, onReturnToLive, reloadSnapshots,
    pinnedCount, onClearPins, graphRef, entities, relationships, tenant, healthV2,
    structureHealth, scenarioLabel, activeSnapshot,
  } = props;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Search */}
        <DropdownMenuItem onClick={onOpenSearch}>
          <Search className="h-3.5 w-3.5 mr-2" />
          Search entities
          <kbd className="ml-auto text-[10px] text-muted-foreground">⌘K</kbd>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* View mode */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Eye className="h-3.5 w-3.5 mr-2" />
            View: {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => onViewModeChange("ownership")}>Ownership</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onViewModeChange("control")}>Control</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onViewModeChange("full")}>Full</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Layout */}
        {!isViewingSnapshot && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LayoutGrid className="h-3.5 w-3.5 mr-2" />
              Layout: {layoutAlgo.charAt(0).toUpperCase() + layoutAlgo.slice(1)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onLayoutAlgoChange("balanced")}>Balanced</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onLayoutAlgoChange("ownership")}>Ownership</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onLayoutAlgoChange("control")}>Control</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {!isViewingSnapshot && (
          <DropdownMenuItem onClick={() => dbLayoutMode === "auto" ? onSwitchToManual() : onResetToAuto()}>
            {dbLayoutMode === "manual" ? (
              <><MousePointer className="h-3.5 w-3.5 mr-2" /> Switch to Auto layout</>
            ) : (
              <><Grid3x3 className="h-3.5 w-3.5 mr-2" /> Switch to Manual layout</>
            )}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onFitView}>
          <Maximize className="h-3.5 w-3.5 mr-2" /> Fit View
        </DropdownMenuItem>

        {!isViewingSnapshot && (
          <DropdownMenuItem onClick={onResetFilters}>
            <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset filters
          </DropdownMenuItem>
        )}

        {pinnedCount > 0 && !isViewingSnapshot && (
          <DropdownMenuItem onClick={onClearPins}>
            <Pin className="h-3.5 w-3.5 mr-2" /> Clear pins ({pinnedCount})
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Output actions */}
        <DropdownMenuItem onClick={onCopyLink}>
          <LinkIcon className="h-3.5 w-3.5 mr-2" /> Copy link
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onToggleLegend}>
          <Palette className="h-3.5 w-3.5 mr-2" /> {showLegend ? "Hide" : "Show"} Legend
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Compare */}
        {structureId && !isScenario && !isViewingSnapshot && (
          <DropdownMenuItem asChild>
            <Link to={`/structures/${structureId}/compare`} className="flex items-center">
              <GitCompareArrows className="h-3.5 w-3.5 mr-2" /> Compare
            </Link>
          </DropdownMenuItem>
        )}
        {structureId && (isScenario || isViewingSnapshot) && (
          <DropdownMenuItem asChild>
            <Link
              to={`/structures/${isScenario ? parentStructureId ?? structureId : structureId}/compare?right=${isViewingSnapshot ? `snapshot:${activeSnapshotId}` : `scenario:${structureId}`}`}
              className="flex items-center"
            >
              <GitCompareArrows className="h-3.5 w-3.5 mr-2" /> Compare
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
