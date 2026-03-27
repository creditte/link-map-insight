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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import dagre from "@dagrejs/dagre";

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

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer px-4 py-2.5 border-2 ${style.bg} ${style.border} ${style.text} ${
        isIndividual ? "rounded-full" : "rounded-lg"
      } ${isTrust ? "border-dashed" : ""} shadow-sm min-w-[140px] max-w-[220px] text-center transition-shadow hover:shadow-md`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <p className="text-xs font-semibold truncate">{label}</p>
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

  const formatEntityType = (type: string) => {
    const map: Record<string, string> = {
      trust_discretionary: "Discretionary Trust",
      trust_unit: "Unit Trust",
      trust_hybrid: "Hybrid Trust",
      trust_bare: "Bare Trust",
      trust_testamentary: "Testamentary Trust",
      trust_deceased_estate: "Deceased Estate",
      trust_family: "Family Trust",
      smsf: "SMSF",
    };
    return map[type] || type;
  };

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
      </div>

      {/* Entity detail side panel */}
      <Sheet open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <SheetContent className="w-[360px] sm:w-[400px]">
          <SheetHeader>
            <SheetTitle className="text-lg">{selectedNode?.name}</SheetTitle>
          </SheetHeader>
          {selectedNode && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase">Type</p>
                  <p className="text-sm font-medium">{formatEntityType(selectedNode.entityType)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase">Structure</p>
                  <p className="text-sm">{selectedNode.businessStructure || "—"}</p>
                </div>
                {selectedNode.abn && (
                  <div>
                    <p className="text-[11px] text-muted-foreground font-medium uppercase">ABN</p>
                    <p className="text-sm font-mono">{selectedNode.abn}</p>
                  </div>
                )}
                {selectedNode.acn && (
                  <div>
                    <p className="text-[11px] text-muted-foreground font-medium uppercase">ACN</p>
                    <p className="text-sm font-mono">{selectedNode.acn}</p>
                  </div>
                )}
              </div>

              {selectedNode.relationships.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-[11px] text-muted-foreground font-medium uppercase mb-2">
                      Relationships ({selectedNode.relationships.length})
                    </p>
                    <div className="space-y-2">
                      {selectedNode.relationships.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/50">
                          <div>
                            <span className="font-medium capitalize">{r.type}</span>
                            <span className="text-muted-foreground"> → {r.relatedClientName || r.relatedClientUuid}</span>
                          </div>
                          {r.percentage != null && r.percentage > 0 && (
                            <Badge variant="outline" className="text-[10px]">{r.percentage}%</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
