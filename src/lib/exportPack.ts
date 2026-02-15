import { toPng, toSvg } from "html-to-image";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { getEntityLabel } from "@/lib/entityTypes";
import { EDGE_COLORS } from "@/components/structure/StructureGraph";

/* ── Helpers ── */

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

/* ── Load image as data URL ── */
async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── Get image natural dimensions ── */
function getImageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 100, h: 40 });
    img.src = dataUrl;
  });
}

/* ── CSV exports ── */

export function exportEntitiesCsv(entities: EntityNode[], prefix: string) {
  const header = "name,entity_type,is_trustee_company,abn,acn,xpm_uuid,created_at";
  const rows = entities.map(
    (e) => `${escapeCsv(e.name)},${escapeCsv(getEntityLabel(e.entity_type))},${e.is_trustee_company ? "Yes" : "No"},${escapeCsv(e.abn ?? "")},${escapeCsv(e.acn ?? "")},${escapeCsv(e.xpm_uuid ?? "")},${e.created_at}`
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

/* ── Image export (PNG / SVG) ── */

export interface ExportMeta {
  userName?: string;
  tenantName?: string;
  logoUrl?: string;
}

export async function exportImage(
  element: HTMLElement,
  format: "png" | "svg",
  filename: string,
  meta?: ExportMeta
) {
  const fn = format === "png" ? toPng : toSvg;
  const dataUrl = await fn(element, {
    backgroundColor: "#ffffff",
    quality: 1,
    pixelRatio: 2,
  });

  if (!meta?.logoUrl) {
    // No logo — direct download
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filename}.${format}`;
    a.click();
    return;
  }

  // Load logo
  const logoDataUrl = await loadImageAsDataUrl(meta.logoUrl);
  if (!logoDataUrl) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filename}.${format}`;
    a.click();
    return;
  }

  if (format === "png") {
    // Overlay logo on PNG canvas
    const logoDims = await getImageDims(logoDataUrl);
    const graphImg = new Image();
    graphImg.src = dataUrl;
    await new Promise((r) => { graphImg.onload = r; });

    const canvas = document.createElement("canvas");
    canvas.width = graphImg.naturalWidth;
    canvas.height = graphImg.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(graphImg, 0, 0);

    const logoImg = new Image();
    logoImg.src = logoDataUrl;
    await new Promise((r) => { logoImg.onload = r; });

    const maxH = 80; // 40px at 2x pixel ratio
    const scale = Math.min(1, maxH / logoDims.h);
    const drawW = logoDims.w * scale;
    const drawH = logoDims.h * scale;
    const margin = 20;
    ctx.drawImage(logoImg, canvas.width - drawW - margin, margin, drawW, drawH);

    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = `${filename}.png`;
    a.click();
  } else {
    // SVG: inject <image> element
    const logoDims = await getImageDims(logoDataUrl);
    const maxH = 40;
    const scale = Math.min(1, maxH / logoDims.h);
    const drawW = logoDims.w * scale;
    const drawH = logoDims.h * scale;

    // Parse SVG, add image before closing </svg>
    let svgText: string;
    if (dataUrl.startsWith("data:image/svg+xml;")) {
      const encoded = dataUrl.split(",")[1];
      svgText = decodeURIComponent(encoded);
    } else {
      svgText = dataUrl;
    }

    // Extract width from SVG for positioning
    const widthMatch = svgText.match(/width="(\d+)"/);
    const svgWidth = widthMatch ? parseInt(widthMatch[1]) : 800;

    const imageEl = `<image href="${logoDataUrl}" x="${svgWidth - drawW - 10}" y="10" width="${drawW}" height="${drawH}" />`;
    svgText = svgText.replace("</svg>", `${imageEl}</svg>`);

    const blob = new Blob([svgText], { type: "image/svg+xml" });
    downloadBlob(blob, `${filename}.svg`);
  }
}

/* ── PDF export ── */

const LEGEND_GROUPS: { title: string; types: string[] }[] = [
  { title: "Ownership", types: ["shareholder", "beneficiary", "partner", "member"] },
  { title: "Control", types: ["director", "trustee", "appointer", "settlor"] },
  { title: "Family", types: ["spouse", "parent", "child"] },
];

const TYPE_ORDER = ["shareholder", "beneficiary", "partner", "member", "director", "trustee", "appointer", "settlor", "spouse", "parent", "child"];

function relSortKey(r: { fromName: string; relType: string; toName: string }) {
  const typeIdx = TYPE_ORDER.indexOf(r.relType);
  return `${String(typeIdx < 0 ? 99 : typeIdx).padStart(2, "0")}_${r.fromName}_${r.toName}`;
}

function addFooter(pdf: jsPDF, structureName: string, pageNum: number, totalPages: number, logoDataUrl?: string | null) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(200);
  pdf.line(14, pageH - 14, pageW - 14, pageH - 14);
  pdf.setFontSize(7);
  pdf.setTextColor(140);
  pdf.text(structureName, 14, pageH - 8);
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - 14, pageH - 8, { align: "right" });

  // Small logo in footer on pages 2+
  if (logoDataUrl && pageNum > 1) {
    try {
      pdf.addImage(logoDataUrl, "PNG", pageW / 2 - 10, pageH - 13, 20, 8);
    } catch { /* skip */ }
  }

  pdf.setTextColor(0);
}

export async function exportPdf(
  graphElement: HTMLElement,
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  structureName: string,
  meta?: ExportMeta
) {
  const exportDate = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const totalPages = 3;

  // Pre-load logo
  let logoDataUrl: string | null = null;
  if (meta?.logoUrl) {
    logoDataUrl = await loadImageAsDataUrl(meta.logoUrl);
  }

  // ─── Page 1: Diagram + title block + legend ───
  pdf.setFontSize(20);
  pdf.text(structureName, 14, 16);
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  const subtitleParts = [
    `${entities.length} entities · ${relationships.length} relationships`,
    `Exported ${exportDate}`,
  ];
  if (meta?.userName) subtitleParts.push(`by ${meta.userName}`);
  if (meta?.tenantName) subtitleParts.push(meta.tenantName);
  pdf.text(subtitleParts.join("  |  "), 14, 23);
  pdf.setTextColor(0);

  // Logo top-right on page 1
  if (logoDataUrl) {
    try {
      const dims = await getImageDims(logoDataUrl);
      const maxH = 14; // ~40px at PDF scale
      const scale = Math.min(1, maxH / dims.h, 50 / dims.w);
      const drawW = dims.w * scale;
      const drawH = dims.h * scale;
      pdf.addImage(logoDataUrl, "PNG", pageW - 14 - drawW, 8, drawW, drawH);
    } catch { /* skip gracefully */ }
  }

  // Diagram image
  try {
    const imgData = await toPng(graphElement, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const imgW = pageW - 28;
    const imgH = pageH - 72;
    pdf.addImage(imgData, "PNG", 14, 28, imgW, imgH);
  } catch {
    pdf.setFontSize(10);
    pdf.text("(Could not render diagram image)", 14, 40);
  }

  // Legend: 2-column grouped table
  const legendStartY = pageH - 40;
  pdf.setFillColor(245, 245, 248);
  pdf.roundedRect(14, legendStartY - 4, pageW - 28, 22, 2, 2, "F");

  let colX = 18;
  let rowY = legendStartY;
  const colWidth = (pageW - 36) / 2;
  let itemCount = 0;

  for (const group of LEGEND_GROUPS) {
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

      if (itemCount === 6) {
        colX = 18 + colWidth;
        rowY = legendStartY;
      }
    }
  }

  pdf.setTextColor(0);
  addFooter(pdf, structureName, 1, totalPages, logoDataUrl);

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
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
  });
  addFooter(pdf, structureName, 2, totalPages, logoDataUrl);

  // ─── Page 3: Entities table ───
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.text("Entities", 14, 16);

  const hasAbn = entities.some((e) => e.abn);
  const hasAcn = entities.some((e) => e.acn);

  const entHead = ["Name", "Type", "Operating", "Trustee Co."];
  if (hasAbn) entHead.push("ABN");
  if (hasAcn) entHead.push("ACN");

  const entBody = entities.map((e) => {
    const typeLabel = e.is_trustee_company
      ? `${getEntityLabel(e.entity_type)} (Trustee)`
      : getEntityLabel(e.entity_type);
    const row = [e.name, typeLabel, e.is_operating_entity ? "Yes" : "No", e.is_trustee_company ? "Yes" : ""];
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
  addFooter(pdf, structureName, 3, totalPages, logoDataUrl);

  pdf.save(`${structureName.replace(/\s+/g, "_")}_pack.pdf`);
}
