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

export function exportEntitiesCsv(entities: EntityNode[], prefix: string) {
  const header = "id,name,entity_type";
  const rows = entities.map(
    (e) => `${e.id},${escapeCsv(e.name)},${escapeCsv(getEntityLabel(e.entity_type))}`
  );
  downloadText([header, ...rows].join("\n"), `${prefix}_entities.csv`);
}

export function exportRelationshipsCsv(
  relationships: RelationshipEdge[],
  entities: EntityNode[],
  prefix: string
) {
  const entityMap = new Map(entities.map((e) => [e.id, e.name]));
  const header = "id,from_entity,to_entity,relationship_type,source";
  const rows = relationships.map(
    (r) =>
      `${r.id},${escapeCsv(entityMap.get(r.from_entity_id) ?? r.from_entity_id)},${escapeCsv(
        entityMap.get(r.to_entity_id) ?? r.to_entity_id
      )},${r.relationship_type},${r.source_data}`
  );
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

export async function exportPdf(
  graphElement: HTMLElement,
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  structureName: string
) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Page 1: Diagram + title + legend
  pdf.setFontSize(18);
  pdf.text(structureName, 14, 16);
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text(`${entities.length} entities · ${relationships.length} relationships`, 14, 23);
  pdf.setTextColor(0);

  try {
    const imgData = await toPng(graphElement, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const imgW = pageW - 28;
    const imgH = pageH - 50;
    pdf.addImage(imgData, "PNG", 14, 28, imgW, imgH);
  } catch {
    pdf.text("(Could not render diagram image)", 14, 40);
  }

  // Legend
  const legendY = pageH - 16;
  let legendX = 14;
  pdf.setFontSize(7);
  for (const [type, color] of Object.entries(EDGE_COLORS)) {
    pdf.setFillColor(color);
    pdf.rect(legendX, legendY, 6, 3, "F");
    pdf.text(type, legendX + 8, legendY + 2.5);
    legendX += 30;
  }

  // Page 2: Relationships table
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Relationships", 14, 16);

  const entityMap = new Map(entities.map((e) => [e.id, e.name]));
  autoTable(pdf, {
    startY: 22,
    head: [["From", "To", "Type", "Source"]],
    body: relationships.map((r) => [
      entityMap.get(r.from_entity_id) ?? r.from_entity_id,
      entityMap.get(r.to_entity_id) ?? r.to_entity_id,
      r.relationship_type,
      r.source_data,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  // Page 3: Entities table
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Entities", 14, 16);

  autoTable(pdf, {
    startY: 22,
    head: [["Name", "Type"]],
    body: entities.map((e) => [e.name, getEntityLabel(e.entity_type)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  pdf.save(`${structureName.replace(/\s+/g, "_")}_pack.pdf`);
}
