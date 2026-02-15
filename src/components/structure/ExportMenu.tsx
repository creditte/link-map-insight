import { useState, useEffect } from "react";
import { Download, Image, FileText, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  exportImage,
  exportEntitiesCsv,
  exportRelationshipsCsv,
  exportPdf,
} from "@/lib/exportPack";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  graphRef: React.RefObject<HTMLElement | null>;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  structureName: string;
}

export default function ExportMenu({ graphRef, entities, relationships, structureName }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [tenantName, setTenantName] = useState("");
  const prefix = structureName.replace(/\s+/g, "_");

  useEffect(() => {
    if (!user) return;
    supabase.from("tenants").select("name").limit(1).single().then(({ data }) => {
      if (data) setTenantName(data.name);
    });
  }, [user]);

  const userName = user?.user_metadata?.full_name || user?.email || "";

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setExporting(true);
    try {
      await fn();
      toast({ title: `${label} exported` });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const getEl = () => {
    const el = graphRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) throw new Error("Graph viewport not found");
    return el;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={exporting}>
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => wrap("PNG", () => exportImage(getEl(), "png", prefix))}>
          <Image className="h-4 w-4 mr-2" /> PNG Image
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => wrap("SVG", () => exportImage(getEl(), "svg", prefix))}>
          <Image className="h-4 w-4 mr-2" /> SVG Image
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { exportEntitiesCsv(entities, prefix); toast({ title: "Entities CSV exported" }); }}>
          <Table className="h-4 w-4 mr-2" /> Entities CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { exportRelationshipsCsv(relationships, entities, prefix); toast({ title: "Relationships CSV exported" }); }}>
          <Table className="h-4 w-4 mr-2" /> Relationships CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => wrap("PDF", () => exportPdf(getEl(), entities, relationships, structureName, { userName, tenantName }))}>
          <FileText className="h-4 w-4 mr-2" /> Full PDF Pack
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
