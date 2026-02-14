import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import EntityNodeComponent from "./EntityNode";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

const nodeTypes = { entity: EntityNodeComponent };

const EDGE_COLORS: Record<string, string> = {
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

function layoutNodes(entities: EntityNode[]): Node[] {
  const cols = Math.max(3, Math.ceil(Math.sqrt(entities.length)));
  const xGap = 220;
  const yGap = 140;

  return entities.map((e, i) => ({
    id: e.id,
    type: "entity",
    position: {
      x: (i % cols) * xGap,
      y: Math.floor(i / cols) * yGap,
    },
    data: { label: e.name, entity_type: e.entity_type },
  }));
}

function buildEdges(relationships: RelationshipEdge[]): Edge[] {
  return relationships.map((r) => ({
    id: r.id,
    source: r.from_entity_id,
    target: r.to_entity_id,
    label: r.relationship_type,
    type: "default",
    animated: false,
    style: { stroke: EDGE_COLORS[r.relationship_type] ?? "#94a3b8", strokeWidth: 2 },
    labelStyle: { fontSize: 10, fill: "#64748b" },
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLORS[r.relationship_type] ?? "#94a3b8" },
  }));
}

interface Props {
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

export default function StructureGraph({ entities, relationships, selectedEntityId, onSelectEntity }: Props) {
  const initialNodes = useMemo(() => layoutNodes(entities), [entities]);
  const initialEdges = useMemo(() => buildEdges(relationships), [relationships]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(layoutNodes(entities));
  }, [entities, setNodes]);

  useEffect(() => {
    setEdges(buildEdges(relationships));
  }, [relationships, setEdges]);

  // Highlight selected
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === selectedEntityId,
      }))
    );
  }, [selectedEntityId, setNodes]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length > 0) {
        onSelectEntity(selectedNodes[0].id);
      }
    },
    [onSelectEntity]
  );

  const onPaneClick = useCallback(() => {
    onSelectEntity(null);
  }, [onSelectEntity]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
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
