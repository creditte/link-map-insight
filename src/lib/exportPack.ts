import { toPng, toSvg } from "html-to-image";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { getEntityLabel } from "@/lib/entityTypes";
import { EDGE_COLORS } from "@/components/structure/StructureGraph";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: "text/csv" }), filename);
}

function escapeCsv(val: string) {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function fmtPercent(v: number | null | undefined): string {
  if (v == null) return "";
  return `${Number(v).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function exportEntitiesCsv(entities: EntityNode[], prefix: string) {
  const header = "name,entity_type,abn,acn,xpm_uuid,created_at";
  const rows = entities.map(
    (e) => `${escapeCsv(e.name)},${escapeCsv(getEntityLabel(e.entity_type))},${escapeCsv(e.abn ?? "")},${escapeCsv(e.acn ?? "")},${escapeCsv(e.xpm_uuid ?? "")},${e.created_at}`
  );
  downloadText([header, ...rows].join("\n"), `${prefix}_entities.csv`);
}

export function exportRelationshipsCsv(
  relationships: RelationshipEdge[],
  entities: EntityNode[],
  prefix: string
) {
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const header = "from_entity_name,from_entity_type,relationship_type,to_entity_name,to_entity_type,ownership_percent,ownership_units,ownership_class,source,created_at";
  const rows = relationships.map((r) => {
    const from = entityMap.get(r.from_entity_id);
    const to = entityMap.get(r.to_entity_id);
    return [
      escapeCsv(from?.name ?? r.from_entity_id),
      escapeCsv(getEntityLabel(from?.entity_type ?? "Unclassified")),
      r.relationship_type,
      escapeCsv(to?.name ?? r.to_entity_id),
      escapeCsv(getEntityLabel(to?.entity_type ?? "Unclassified")),
      r.ownership_percent ?? "",
      r.ownership_units ?? "",
      escapeCsv(r.ownership_class ?? ""),
      r.source_data,
      r.created_at,
    ].join(",");
  });
  downloadText([header, ...rows].join("\n"), `${prefix}_relationships.csv`);
}

export async function exportImage(
  element: HTMLElement,
  format: "png" | "svg",
  filename: string
) {
  const fn = format === "png" ? toPng : toSvg;
  const dataUrl = await fn(element, {
    backgroundColor: "#ffffff",
    quality: 1,
    pixelRatio: 2,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${filename}.${format}`;
  a.click();
}

/* ── Legend groups for PDF ── */
const LEGEND_GROUPS: { title: string; types: string[] }[] = [
  { title: "Ownership", types: ["shareholder", "beneficiary", "partner", "member"] },
  { title: "Control", types: ["director", "trustee", "appointer", "settlor"] },
  { title: "Family", types: ["spouse", "parent", "child"] },
];

/* ── Sort helpers ── */
const TYPE_ORDER = ["shareholder", "beneficiary", "partner", "member", "director", "trustee", "appointer", "settlor", "spouse", "parent", "child"];

function relSortKey(r: { fromName: string; relType: string; toName: string }) {
  const typeIdx = TYPE_ORDER.indexOf(r.relType);
  return `${String(typeIdx < 0 ? 99 : typeIdx).padStart(2, "0")}_${r.fromName}_${r.toName}`;
}

/* ── Footer helper ── */
function addFooter(pdf: jsPDF, structureName: string, pageNum: number, totalPages: number) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(200);
  pdf.line(14, pageH - 12, pageW - 14, pageH - 12);
  pdf.setFontSize(7);
  pdf.setTextColor(140);
  pdf.text(structureName, 14, pageH - 7);
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - 14, pageH - 7, { align: "right" });
  pdf.setTextColor(0);
}

export interface PdfMeta {
  userName?: string;
  tenantName?: string;
}

export async function exportPdf(
  graphElement: HTMLElement,
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  structureName: string,
  meta?: PdfMeta
) {
  const exportDate = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const totalPages = 3;

  // ─── Page 1: Diagram + title block + legend ───
  // Title block
  pdf.setFontSize(20);
  pdf.text(structureName, 14, 16);
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  const subtitleParts = [
    `${entities.length} entities · ${relationships.length} relationships`,
    `Exported ${exportDate}`,
  ];
  if (meta?.userName) subtitleParts.push(`by ${meta.userName}`);
  if (meta?.tenantName) subtitleParts.push(`${meta.tenantName}`);
  pdf.text(subtitleParts.join("  |  "), 14, 23);
  pdf.setTextColor(0);

  // Diagram image with more padding
  try {
    const imgData = await toPng(graphElement, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const imgW = pageW - 28;
    const imgH = pageH - 70; // more padding for legend
    pdf.addImage(imgData, "PNG", 14, 28, imgW, imgH);
  } catch {
    pdf.setFontSize(10);
    pdf.text("(Could not render diagram image)", 14, 40);
  }

  // Legend: 2-column grouped table
  const legendStartY = pageH - 38;
  pdf.setFillColor(245, 245, 248);
  pdf.roundedRect(14, legendStartY - 4, pageW - 28, 22, 2, 2, "F");

  let colX = 18;
  let rowY = legendStartY;
  const colWidth = (pageW - 36) / 2;
  let itemCount = 0;

  for (const group of LEGEND_GROUPS) {
    // Group title
    pdf.setFontSize(7);
    pdf.setTextColor(100);
    pdf.setFont("helvetica", "bold");
    pdf.text(group.title, colX, rowY + 2);
    pdf.setFont("helvetica", "normal");
    rowY += 4;

    for (const type of group.types) {
      const color = EDGE_COLORS[type];
      if (!color) continue;
      pdf.setFillColor(color);
      pdf.rect(colX, rowY - 1.5, 5, 2.5, "F");
      pdf.setFontSize(7);
      pdf.setTextColor(60);
      pdf.text(type, colX + 7, rowY + 0.5);
      rowY += 3.5;
      itemCount++;

      // Switch to second column
      if (itemCount === 6) {
        colX = 18 + colWidth;
        rowY = legendStartY;
      }
    }
  }

  pdf.setTextColor(0);
  addFooter(pdf, structureName, 1, totalPages);

  // ─── Page 2: Relationships table ───
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Relationships", 14, 16);

  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const relRows = relationships.map((r) => {
    const from = entityMap.get(r.from_entity_id);
    const to = entityMap.get(r.to_entity_id);
    return {
      fromName: from?.name ?? r.from_entity_id,
      relType: r.relationship_type,
      toName: to?.name ?? r.to_entity_id,
      pct: fmtPercent(r.ownership_percent),
      units: r.ownership_units != null ? String(r.ownership_units) : "",
      cls: r.ownership_class ?? "",
    };
  });
  relRows.sort((a, b) => relSortKey(a).localeCompare(relSortKey(b)));

  autoTable(pdf, {
    startY: 22,
    head: [["From", "Relationship", "To", "Ownership %", "Units", "Class"]],
    body: relRows.map((r) => [r.fromName, r.relType, r.toName, r.pct, r.units, r.cls]),
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
    },
  });
  addFooter(pdf, structureName, 2, totalPages);

  // ─── Page 3: Entities table ───
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Entities", 14, 16);

  const hasAbn = entities.some((e) => e.abn);
  const hasAcn = entities.some((e) => e.acn);

  const entHead = ["Name", "Type", "Operating"];
  if (hasAbn) entHead.push("ABN");
  if (hasAcn) entHead.push("ACN");

  const entBody = entities.map((e) => {
    const row = [e.name, getEntityLabel(e.entity_type), e.is_operating_entity ? "Yes" : "No"];
    if (hasAbn) row.push(e.abn ?? "");
    if (hasAcn) row.push(e.acn ?? "");
    return row;
  });

  autoTable(pdf, {
    startY: 22,
    head: [entHead],
    body: entBody,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
  });
  addFooter(pdf, structureName, 3, totalPages);

  pdf.save(`${structureName.replace(/\s+/g, "_")}_pack.pdf`);
}
