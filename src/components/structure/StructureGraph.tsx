import { useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";

import EntityNodeComponent from "./EntityNode";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const nodeTypes = { entity: EntityNodeComponent };

export const EDGE_COLORS: Record<string, string> = {
  director: "#3b82f6",
  shareholder: "#10b981",
  beneficiary: "#f59e0b",
  trustee: "#8b5cf6",
  appointer: "#ec4899",
  settlor: "#6366f1",
  partner: "#14b8a6",
  member: "#0ea5e9",
  spouse: "#f43f5e",
  parent: "#a855f7",
  child: "#06b6d4",
};

export type LayoutMode = "balanced" | "ownership" | "control";
export type LayoutStrategy = "auto" | "manual";

const OWNERSHIP_TYPES = new Set(["shareholder", "beneficiary"]);
const CONTROL_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

function dagreLayout(
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  mode: LayoutMode = "balanced",
  pinnedPositions: Map<string, { x: number; y: number }> = new Map()
): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100, edgesep: 40 });

  // Operating entities get rank 0 (top tier)
  entities.forEach((e) => {
    const nodeOpts: Record<string, unknown> = { width: 180, height: 70 };
    if (e.is_operating_entity) {
      nodeOpts.rank = 0;
    }
    g.setNode(e.id, nodeOpts);
  });

  relationships.forEach((r) => {
    let weight = 1;
    if (mode === "ownership" && OWNERSHIP_TYPES.has(r.relationship_type)) weight = 10;
    if (mode === "control" && CONTROL_TYPES.has(r.relationship_type)) weight = 10;
    g.setEdge(r.from_entity_id, r.to_entity_id, { weight });
  });

  Dagre.layout(g);

  return entities.map((e) => {
    const pinned = pinnedPositions.get(e.id);
    if (pinned) {
      return {
        id: e.id,
        type: "entity",
        position: pinned,
        data: { label: e.name, entity_type: e.entity_type, pinned: true, is_operating_entity: e.is_operating_entity },
      };
    }
    const node = g.node(e.id);
    return {
      id: e.id,
      type: "entity",
      position: { x: (node?.x ?? 0) - 90, y: (node?.y ?? 0) - 35 },
      data: { label: e.name, entity_type: e.entity_type, pinned: false, is_operating_entity: e.is_operating_entity, is_trustee_company: e.is_trustee_company },
    };
  });
}

const CONTROL_EDGE_TYPES = new Set(["director", "trustee", "appointer", "settlor"]);

function buildEdgeLabel(r: RelationshipEdge): string {
  let label = r.relationship_type;
  const parts: string[] = [];
  if (r.ownership_percent != null) parts.push(`${r.ownership_percent}%`);
  if (r.ownership_units != null) parts.push(`${r.ownership_units} units`);
  if (r.ownership_class) parts.push(`(${r.ownership_class})`);
  if (parts.length > 0) label += " " + parts.join(" ");
  return label;
}

function buildEdges(relationships: RelationshipEdge[], viewMode: string = "full"): Edge[] {
  return relationships.map((r) => {
    const isControl = CONTROL_EDGE_TYPES.has(r.relationship_type);
    const deEmphasize = viewMode !== "control" && isControl;
    return {
      id: r.id,
      source: r.from_entity_id,
      target: r.to_entity_id,
      label: buildEdgeLabel(r),
      type: "default",
      animated: false,
      style: {
        stroke: EDGE_COLORS[r.relationship_type] ?? "#94a3b8",
        strokeWidth: deEmphasize ? 1 : 2,
        opacity: deEmphasize ? 0.4 : 1,
        cursor: "pointer",
      },
      labelStyle: { fontSize: 10, fill: "#64748b", opacity: deEmphasize ? 0.5 : 1 },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: EDGE_COLORS[r.relationship_type] ?? "#94a3b8",
      },
    };
  });
}

interface Props {
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  autoLayoutTrigger: number;
  layoutMode: LayoutMode;
  layoutStrategy: LayoutStrategy;
  pinnedNodeIds: Set<string>;
  onTogglePin: (id: string) => void;
  viewMode: string;
  searchHighlightId: string | null;
  fitViewTrigger: number;
  structureId: string;
  onNodePositionsSaved?: () => void;
}

const POSITIONS_KEY_PREFIX = "structure_node_positions_";

function getSavedPositions(structureId: string): Map<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY_PREFIX + structureId);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function savePositions(structureId: string, positions: Map<string, { x: number; y: number }>) {
  const obj: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of positions) obj[k] = v;
  localStorage.setItem(POSITIONS_KEY_PREFIX + structureId, JSON.stringify(obj));
}

export function clearSavedPositions(structureId: string) {
  localStorage.removeItem(POSITIONS_KEY_PREFIX + structureId);
}

function StructureGraphInner({
  entities, relationships, selectedEntityId, onSelectEntity, onSelectEdge,
  autoLayoutTrigger, layoutMode, layoutStrategy, pinnedNodeIds, onTogglePin, viewMode,
  searchHighlightId, fitViewTrigger, structureId, onNodePositionsSaved,
}: Props) {
  const { fitView } = useReactFlow();
  const prevLayoutTrigger = useRef(0);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const getPinnedPositions = useCallback(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const id of pinnedNodeIds) {
      const pos = nodePositionsRef.current.get(id);
      if (pos) map.set(id, pos);
    }
    return map;
  }, [pinnedNodeIds]);

  // In manual mode, use saved positions; in auto mode, use dagre
  const initialNodes = useMemo(() => {
    if (layoutStrategy === "manual") {
      const saved = getSavedPositions(structureId);
      if (saved.size > 0) {
        // Use saved positions for nodes that have them, dagre for the rest
        const dagreNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
        return dagreNodes.map((n) => {
          const savedPos = saved.get(n.id);
          return savedPos ? { ...n, position: savedPos } : n;
        });
      }
    }
    return dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
  }, [entities, relationships, layoutMode, getPinnedPositions, layoutStrategy, structureId]);
  const initialEdges = useMemo(() => buildEdges(relationships, viewMode), [relationships, viewMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Track positions on drag and persist in manual mode
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);
      let hasDrag = false;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          nodePositionsRef.current.set(change.id, change.position);
          hasDrag = true;
        }
      }
      // Debounced save in manual mode
      if (hasDrag && layoutStrategy === "manual") {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          savePositions(structureId, nodePositionsRef.current);
          onNodePositionsSaved?.();
        }, 500);
      }
    },
    [onNodesChange, layoutStrategy, structureId, onNodePositionsSaved]
  );

  useEffect(() => {
    if (layoutStrategy === "manual") {
      const saved = getSavedPositions(structureId);
      if (saved.size > 0) {
        const dagreNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
        const merged = dagreNodes.map((n) => {
          const savedPos = saved.get(n.id);
          return savedPos ? { ...n, position: savedPos } : n;
        });
        setNodes(merged);
        for (const n of merged) nodePositionsRef.current.set(n.id, n.position);
      } else {
        const newNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
        setNodes(newNodes);
        for (const n of newNodes) nodePositionsRef.current.set(n.id, n.position);
      }
    } else {
      const newNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
      setNodes(newNodes);
      for (const n of newNodes) {
        if (!nodePositionsRef.current.has(n.id)) {
          nodePositionsRef.current.set(n.id, n.position);
        }
      }
    }
    setEdges(buildEdges(relationships, viewMode));
  }, [entities, relationships, layoutMode, viewMode, setNodes, setEdges, getPinnedPositions, layoutStrategy, structureId]);

  // Auto-layout button trigger — always runs dagre and clears saved positions
  useEffect(() => {
    if (autoLayoutTrigger > 0 && autoLayoutTrigger !== prevLayoutTrigger.current) {
      prevLayoutTrigger.current = autoLayoutTrigger;
      clearSavedPositions(structureId);
      const newNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
      setNodes(newNodes);
      for (const n of newNodes) {
        nodePositionsRef.current.set(n.id, n.position);
      }
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    }
  }, [autoLayoutTrigger, entities, relationships, layoutMode, setNodes, fitView, getPinnedPositions, structureId]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === selectedEntityId,
        style: {
          opacity: searchHighlightId && n.id !== searchHighlightId ? 0.25 : 1,
          transition: "opacity 0.2s ease",
        },
        data: { ...n.data, pinned: pinnedNodeIds.has(n.id) },
      }))
    );
  }, [selectedEntityId, pinnedNodeIds, searchHighlightId, setNodes]);

  // Zoom to highlighted search node
  useEffect(() => {
    if (searchHighlightId) {
      setTimeout(() => fitView({ padding: 0.5, nodes: [{ id: searchHighlightId }], duration: 300 }), 50);
    }
  }, [searchHighlightId, fitView]);

  // Fit view trigger from parent
  const prevFitViewTrigger = useRef(0);
  useEffect(() => {
    if (fitViewTrigger > 0 && fitViewTrigger !== prevFitViewTrigger.current) {
      prevFitViewTrigger.current = fitViewTrigger;
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [fitViewTrigger, fitView]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length > 0) {
        onSelectEntity(selectedNodes[0].id);
        onSelectEdge(null);
      }
    },
    [onSelectEntity, onSelectEdge]
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      onSelectEdge(edge.id);
      onSelectEntity(null);
    },
    [onSelectEdge, onSelectEntity]
  );

  const onPaneClick = useCallback(() => {
    onSelectEntity(null);
    onSelectEdge(null);
  }, [onSelectEntity, onSelectEdge]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onTogglePin(node.id);
    },
    [onTogglePin]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onNodeDoubleClick={onNodeDoubleClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeStrokeWidth={3}
        className="!bg-card !border-border"
        maskColor="hsl(var(--muted) / 0.5)"
      />
    </ReactFlow>
  );
}

const StructureGraph = forwardRef<HTMLDivElement, Props>(function StructureGraph(props, ref) {
  return (
    <ReactFlowProvider>
      <div ref={ref} className="h-full w-full">
        <StructureGraphInner {...props} />
      </div>
    </ReactFlowProvider>
  );
});

export default StructureGraph;
