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
  spouse: "#f43f5e",
  parent: "#a855f7",
  child: "#06b6d4",
};

export type LayoutMode = "balanced" | "ownership" | "control";

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

  entities.forEach((e) => {
    g.setNode(e.id, { width: 180, height: 70 });
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
        data: { label: e.name, entity_type: e.entity_type, pinned: true },
      };
    }
    const node = g.node(e.id);
    return {
      id: e.id,
      type: "entity",
      position: { x: (node?.x ?? 0) - 90, y: (node?.y ?? 0) - 35 },
      data: { label: e.name, entity_type: e.entity_type, pinned: false },
    };
  });
}

function buildEdges(relationships: RelationshipEdge[]): Edge[] {
  return relationships.map((r) => ({
    id: r.id,
    source: r.from_entity_id,
    target: r.to_entity_id,
    label: r.relationship_type,
    type: "default",
    animated: false,
    style: { stroke: EDGE_COLORS[r.relationship_type] ?? "#94a3b8", strokeWidth: 2, cursor: "pointer" },
    labelStyle: { fontSize: 10, fill: "#64748b" },
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: EDGE_COLORS[r.relationship_type] ?? "#94a3b8",
    },
  }));
}

interface Props {
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  autoLayoutTrigger: number;
  layoutMode: LayoutMode;
  pinnedNodeIds: Set<string>;
  onTogglePin: (id: string) => void;
}

function StructureGraphInner({
  entities, relationships, selectedEntityId, onSelectEntity, onSelectEdge,
  autoLayoutTrigger, layoutMode, pinnedNodeIds, onTogglePin,
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

  const initialNodes = useMemo(
    () => dagreLayout(entities, relationships, layoutMode, getPinnedPositions()),
    [entities, relationships, layoutMode, getPinnedPositions]
  );
  const initialEdges = useMemo(() => buildEdges(relationships), [relationships]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Track positions on drag
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          nodePositionsRef.current.set(change.id, change.position);
        }
      }
    },
    [onNodesChange]
  );

  useEffect(() => {
    const newNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
    setNodes(newNodes);
    setEdges(buildEdges(relationships));
    // Store initial positions
    for (const n of newNodes) {
      if (!nodePositionsRef.current.has(n.id)) {
        nodePositionsRef.current.set(n.id, n.position);
      }
    }
  }, [entities, relationships, layoutMode, setNodes, setEdges, getPinnedPositions]);

  // Auto-layout button trigger
  useEffect(() => {
    if (autoLayoutTrigger > 0 && autoLayoutTrigger !== prevLayoutTrigger.current) {
      prevLayoutTrigger.current = autoLayoutTrigger;
      const newNodes = dagreLayout(entities, relationships, layoutMode, getPinnedPositions());
      setNodes(newNodes);
      for (const n of newNodes) {
        nodePositionsRef.current.set(n.id, n.position);
      }
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    }
  }, [autoLayoutTrigger, entities, relationships, layoutMode, setNodes, fitView, getPinnedPositions]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === selectedEntityId,
        data: { ...n.data, pinned: pinnedNodeIds.has(n.id) },
      }))
    );
  }, [selectedEntityId, pinnedNodeIds, setNodes]);

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
