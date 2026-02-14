import { useCallback, useEffect, useMemo, useRef } from "react";
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

function gridLayout(entities: EntityNode[]): Node[] {
  const cols = Math.max(3, Math.ceil(Math.sqrt(entities.length)));
  const xGap = 220;
  const yGap = 140;
  return entities.map((e, i) => ({
    id: e.id,
    type: "entity",
    position: { x: (i % cols) * xGap, y: Math.floor(i / cols) * yGap },
    data: { label: e.name, entity_type: e.entity_type },
  }));
}

function dagreLayout(entities: EntityNode[], relationships: RelationshipEdge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100, edgesep: 40 });

  entities.forEach((e) => {
    g.setNode(e.id, { width: 180, height: 70 });
  });
  relationships.forEach((r) => {
    g.setEdge(r.from_entity_id, r.to_entity_id);
  });

  Dagre.layout(g);

  return entities.map((e) => {
    const node = g.node(e.id);
    return {
      id: e.id,
      type: "entity",
      position: { x: (node?.x ?? 0) - 90, y: (node?.y ?? 0) - 35 },
      data: { label: e.name, entity_type: e.entity_type },
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
}

function StructureGraphInner({
  entities, relationships, selectedEntityId, onSelectEntity, onSelectEdge, autoLayoutTrigger,
}: Props) {
  const { fitView } = useReactFlow();
  const prevLayoutTrigger = useRef(0);

  const initialNodes = useMemo(() => dagreLayout(entities, relationships), [entities, relationships]);
  const initialEdges = useMemo(() => buildEdges(relationships), [relationships]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(dagreLayout(entities, relationships));
    setEdges(buildEdges(relationships));
  }, [entities, relationships, setNodes, setEdges]);

  // Auto-layout button trigger
  useEffect(() => {
    if (autoLayoutTrigger > 0 && autoLayoutTrigger !== prevLayoutTrigger.current) {
      prevLayoutTrigger.current = autoLayoutTrigger;
      setNodes(dagreLayout(entities, relationships));
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    }
  }, [autoLayoutTrigger, entities, relationships, setNodes, fitView]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: n.id === selectedEntityId }))
    );
  }, [selectedEntityId, setNodes]);

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
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

export default function StructureGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <StructureGraphInner {...props} />
    </ReactFlowProvider>
  );
}
