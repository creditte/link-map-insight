import { useState } from "react";
import { Download, Image, FileText, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  exportImage,
  exportEntitiesCsv,
  exportRelationshipsCsv,
  exportPdf,
} from "@/lib/exportPack";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import type { TenantSettings } from "@/hooks/useTenantSettings";
import type { HealthScoreV2 } from "@/lib/structureScoring";

interface Props {
  graphRef: React.RefObject<HTMLElement | null>;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  structureName: string;
  snapshotName?: string;
  snapshotCreatedAt?: string;
  isScenario?: boolean;
  scenarioLabel?: string;
  tenant?: TenantSettings | null;
  disabled?: boolean;
  healthV2?: HealthScoreV2;
}

export default function ExportMenu({ graphRef, entities, relationships, structureName, snapshotName, snapshotCreatedAt, isScenario, scenarioLabel, tenant, disabled, healthV2 }: Props) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [includeHealth, setIncludeHealth] = useState(true);
  const [includeChecklist, setIncludeChecklist] = useState(true);
  const prefix = structureName.replace(/\s+/g, "_");

  const userName = "";
  const tenantName = tenant?.firm_name || tenant?.name || "";
  const logoUrl = tenant?.logo_url ?? null;

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

  const meta = {
    userName,
    tenantName,
    logoUrl: logoUrl ?? undefined,
    snapshotName,
    snapshotCreatedAt,
    isScenario,
    scenarioLabel,
    brandColor: tenant?.brand_primary_color ?? undefined,
    footerText: tenant?.export_footer_text ?? undefined,
    disclaimerText: tenant?.export_show_disclaimer ? (tenant?.export_disclaimer_text ?? undefined) : undefined,
  };

  const handlePdfExport = () => {
    setShowPdfDialog(false);
    wrap("PDF", () => exportPdf(getEl(), entities, relationships, structureName, meta, {
      includeHealthSummary: includeHealth,
      healthScore: healthV2,
      includeChecklist,
    }));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={exporting || disabled}>
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => wrap("PNG", () => exportImage(getEl(), "png", prefix, meta))}>
            <Image className="h-4 w-4 mr-2" /> PNG Image
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => wrap("SVG", () => exportImage(getEl(), "svg", prefix, meta))}>
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
          <DropdownMenuItem onClick={() => setShowPdfDialog(true)}>
            <FileText className="h-4 w-4 mr-2" /> Premium PDF Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* PDF Export Options Dialog */}
      <Dialog open={showPdfDialog} onOpenChange={setShowPdfDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PDF Export Options</DialogTitle>
            <DialogDescription>
              Choose which sections to include in the PDF pack.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-health"
                checked={includeHealth}
                onCheckedChange={(v) => setIncludeHealth(!!v)}
              />
              <Label htmlFor="include-health" className="text-sm">
                Include Structure Health Summary
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-checklist"
                checked={includeChecklist}
                onCheckedChange={(v) => setIncludeChecklist(!!v)}
              />
              <Label htmlFor="include-checklist" className="text-sm">
                Include Governance Checklist
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPdfDialog(false)}>Cancel</Button>
            <Button onClick={handlePdfExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
