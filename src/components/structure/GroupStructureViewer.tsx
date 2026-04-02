import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Handle,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import dagre from "@dagrejs/dagre";
import { getEntityLabel, getEntityIcon } from "@/lib/entityTypes";
import { formatAbn, formatAcn } from "./EntityInfoFields";

interface GroupNode {
  id: string;
  name: string;
  entityType: string;
  abn: string | null;
  acn: string | null;
  businessStructure: string;
  relationships: Array<{
    type: string;
    relatedClientUuid: string;
    relatedClientName: string;
    percentage: number | null;
  }>;
}

interface GroupEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  percentage: number | null;
}

interface GroupStructureViewerProps {
  groupUuid: string;
  groupName: string;
  onClose: () => void;
}

// ── Custom node component ──────────────────────────────────────────
function EntityNodeComponent({ data }: { data: any }) {
  const { label, entityType, abn, acn, onClick } = data;

  const getStyle = (): { bg: string; border: string; text: string; dashed?: boolean } => {
    switch (entityType) {
      case "Individual":
        return { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-800 dark:text-emerald-200" };
      case "Company":
        return { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-300 dark:border-blue-700", text: "text-blue-800 dark:text-blue-200" };
      case "Trust":
      case "trust_discretionary":
      case "trust_unit":
      case "trust_hybrid":
      case "trust_bare":
      case "trust_testamentary":
      case "trust_deceased_estate":
      case "trust_family":
        return { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-300 dark:border-amber-700", text: "text-amber-800 dark:text-amber-200", dashed: true };
      case "smsf":
        return { bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-300 dark:border-purple-700", text: "text-purple-800 dark:text-purple-200" };
      default:
        return { bg: "bg-muted/50", border: "border-border", text: "text-muted-foreground" };
    }
  };

  const style = getStyle();
  const isIndividual = entityType === "Individual";
  const isTrust = entityType?.startsWith("trust_") || entityType === "Trust";

  const typeLabel = getEntityLabel(entityType);

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer px-4 py-2.5 border-2 ${style.bg} ${style.border} ${style.text} ${
        isIndividual ? "rounded-full" : "rounded-lg"
      } ${isTrust ? "border-dashed" : ""} shadow-sm min-w-[140px] max-w-[220px] text-center transition-shadow hover:shadow-md`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <p className="text-xs font-semibold truncate">{label}</p>
      <p className="text-[9px] opacity-60 mt-0.5">{typeLabel}</p>
      {(abn || acn) && (
        <p className="text-[10px] opacity-70 mt-0.5 truncate">
          {abn ? `ABN ${abn}` : `ACN ${acn}`}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </div>
  );
}

const nodeTypes = { entity: EntityNodeComponent };

// ── Layout with dagre ──────────────────────────────────────────────
function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: 180, height: 60 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 90, y: pos.y - 30 },
    };
  });
}

export default function GroupStructureViewer({ groupUuid, groupName, onClose }: GroupStructureViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupNodes, setGroupNodes] = useState<GroupNode[]>([]);
  const [groupEdges, setGroupEdges] = useState<GroupEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GroupNode | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    async function fetchGroup() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("fetch-xpm-group", {
          body: { group_uuid: groupUuid },
        });
        if (fnError) throw fnError;
        if (data?.error) throw new Error(data.error);

        setGroupNodes(data.nodes ?? []);
        setGroupEdges(data.edges ?? []);
      } catch (err: any) {
        setError(err.message || "Failed to fetch group data");
      } finally {
        setLoading(false);
      }
    }
    fetchGroup();
  }, [groupUuid]);

  // Build React Flow nodes/edges from data
  useEffect(() => {
    if (groupNodes.length === 0) return;

    const rfNodes: Node[] = groupNodes.map((n) => ({
      id: n.id,
      type: "entity",
      position: { x: 0, y: 0 },
      data: {
        label: n.name,
        entityType: n.entityType,
        abn: n.abn,
        acn: n.acn,
        onClick: () => setSelectedNode(n),
      },
    }));

    const rfEdges: Edge[] = groupEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.percentage && e.percentage > 0
        ? `${e.type} (${e.percentage}%)`
        : e.type,
      type: "default",
      animated: false,
      style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
    }));

    const laid = layoutGraph(rfNodes, rfEdges);
    setNodes(laid);
    setEdges(rfEdges);
  }, [groupNodes, groupEdges]);

  const GROUP_ORDER = [
    "director", "shareholder", "trustee", "beneficiary", "spouse",
    "appointer", "settlor", "partner", "member", "parent", "child",
  ];

  const GROUP_COLORS: Record<string, string> = {
    director: "bg-blue-500",
    shareholder: "bg-emerald-500",
    trustee: "bg-amber-500",
    beneficiary: "bg-purple-500",
    spouse: "bg-muted-foreground",
  };

  const formatEntityType = (type: string) => getEntityLabel(type);

  // Group relationships by type for the selected node
  const groupedRelationships = useMemo(() => {
    if (!selectedNode) return [];
    const groups = new Map<string, typeof selectedNode.relationships>();
    for (const r of selectedNode.relationships) {
      const arr = groups.get(r.type) ?? [];
      arr.push(r);
      groups.set(r.type, arr);
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [selectedNode]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{groupName}</h3>
          {!loading && (
            <Badge variant="secondary" className="text-[10px]">
              {groupNodes.length} members
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading group structure...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : groupNodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No members found in this group.</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}

        {/* Entity detail side panel */}
        {selectedNode && (
          <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l bg-card shadow-lg">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-sm">Entity Details</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedNode(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Entity header */}
              {(() => {
                const Icon = getEntityIcon(selectedNode.entityType);
                return (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium leading-tight">{selectedNode.name}</p>
                      <p className="text-xs text-muted-foreground">{formatEntityType(selectedNode.entityType)}</p>
                      {selectedNode.businessStructure && selectedNode.businessStructure !== selectedNode.entityType && (
                        <p className="text-[10px] text-muted-foreground">{selectedNode.businessStructure}</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Info fields */}
              {(selectedNode.abn || selectedNode.acn) && (
                <div className="space-y-1.5 rounded-md border p-3 bg-muted/30">
                  {selectedNode.abn && (
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-muted-foreground">ABN</p>
                      <span className="text-xs font-mono">{selectedNode.abn}</span>
                    </div>
                  )}
                  {selectedNode.acn && (
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-muted-foreground">ACN</p>
                      <span className="text-xs font-mono">{selectedNode.acn}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Relationships grouped */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <p className="text-xs font-medium text-muted-foreground">Relationships</p>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem] justify-center">
                    {selectedNode.relationships.length}
                  </Badge>
                </div>

                {selectedNode.relationships.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No relationships</p>
                ) : (
                  <div className="space-y-3">
                    {groupedRelationships.map(([type, items]) => {
                      const pillColor = GROUP_COLORS[type] ?? "bg-muted-foreground";
                      const label = type === "appointer" ? "Appointors" : type.charAt(0).toUpperCase() + type.slice(1) + "s";
                      return (
                        <div key={type}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`inline-block h-2 w-2 rounded-full ${pillColor}`} />
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {label}
                            </p>
                            <span className="text-[10px] text-muted-foreground">({items.length})</span>
                          </div>
                          <div className="space-y-1">
                            {items.map((r, i) => (
                              <button
                                key={i}
                                className="flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent"
                                onClick={() => {
                                  const target = groupNodes.find((n) => n.id === r.relatedClientUuid);
                                  if (target) setSelectedNode(target);
                                }}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="truncate font-medium text-xs">{r.relatedClientName || r.relatedClientUuid}</p>
                                  {r.percentage != null && r.percentage > 0 && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 mt-0.5">
                                      {r.percentage}%
                                    </Badge>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
