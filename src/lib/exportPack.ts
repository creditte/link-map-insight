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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const header = "name,entity_type,is_operating_entity,is_trustee_company,abn,acn,xpm_uuid,created_at";
  const rows = entities.map(
    (e) => [
      escapeCsv(e.name),
      escapeCsv(getEntityLabel(e.entity_type)),
      e.is_operating_entity ? "Yes" : "No",
      e.is_trustee_company ? "Yes" : "No",
      escapeCsv(e.abn ?? ""),
      escapeCsv(e.acn ?? ""),
      escapeCsv(e.xpm_uuid ?? ""),
      e.created_at,
    ].join(",")
  );
  downloadText([header, ...rows].join("\n"), `${prefix}_entities.csv`);
}

export function exportRelationshipsCsv(
  relationships: RelationshipEdge[],
  entities: EntityNode[],
  prefix: string
) {
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const header = "from_entity_name,from_entity_type,relationship_type,to_entity_name,to_entity_type,ownership_percent,ownership_units,ownership_class,created_at";
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
  snapshotName?: string;
  snapshotCreatedAt?: string;
  isScenario?: boolean;
  scenarioLabel?: string;
  brandColor?: string;
  footerText?: string;
  disclaimerText?: string;
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
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filename}.${format}`;
    a.click();
    return;
  }

  const logoDataUrl = await loadImageAsDataUrl(meta.logoUrl);
  if (!logoDataUrl) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filename}.${format}`;
    a.click();
    return;
  }

  if (format === "png") {
    const logoDims = await getImageDims(logoDataUrl);
    const graphImg = new window.Image();
    graphImg.src = dataUrl;
    await new Promise((r) => { graphImg.onload = r; });

    const canvas = document.createElement("canvas");
    canvas.width = graphImg.naturalWidth;
    canvas.height = graphImg.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(graphImg, 0, 0);

    const logoImg = new window.Image();
    logoImg.src = logoDataUrl;
    await new Promise((r) => { logoImg.onload = r; });

    const maxH = 80;
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
    const logoDims = await getImageDims(logoDataUrl);
    const maxH = 40;
    const scale = Math.min(1, maxH / logoDims.h);
    const drawW = logoDims.w * scale;
    const drawH = logoDims.h * scale;

    let svgText: string;
    if (dataUrl.startsWith("data:image/svg+xml;")) {
      const encoded = dataUrl.split(",")[1];
      svgText = decodeURIComponent(encoded);
    } else {
      svgText = dataUrl;
    }

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
  { title: "Ownership", types: ["shareholder", "beneficiary"] },
  { title: "Control", types: ["director", "trustee", "appointer", "settlor"] },
  { title: "Membership", types: ["partner", "member"] },
  { title: "Family", types: ["spouse", "parent", "child"] },
];

const TYPE_ORDER = ["shareholder", "beneficiary", "partner", "member", "director", "trustee", "appointer", "settlor", "spouse", "parent", "child"];

function relSortKey(r: { fromName: string; relType: string; toName: string }) {
  const typeIdx = TYPE_ORDER.indexOf(r.relType);
  return `${String(typeIdx < 0 ? 99 : typeIdx).padStart(2, "0")}_${r.fromName}_${r.relType}_${r.toName}`;
}

/** Parse hex color to [r,g,b] tuple */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function addFooter(
  pdf: jsPDF,
  structureName: string,
  pageNum: number,
  totalPages: number,
  opts?: { logoDataUrl?: string | null; footerText?: string; disclaimerText?: string; brandColor?: string }
) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const lineColor = opts?.brandColor ? hexToRgb(opts.brandColor) : [200, 200, 200] as [number, number, number];
  pdf.setDrawColor(...lineColor);
  pdf.line(14, pageH - 18, pageW - 14, pageH - 18);
  pdf.setFontSize(7);
  pdf.setTextColor(140);

  const footerLabel = opts?.footerText || structureName;
  pdf.text(footerLabel, 14, pageH - 12);
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - 14, pageH - 12, { align: "right" });

  if (opts?.logoDataUrl && pageNum > 1) {
    try {
      pdf.addImage(opts.logoDataUrl, "PNG", pageW / 2 - 10, pageH - 17, 20, 8);
    } catch { /* skip */ }
  }

  // Short disclaimer on pages 2+
  if (opts?.disclaimerText && pageNum > 1) {
    pdf.setFontSize(6);
    pdf.setTextColor(160);
    const shortDisclaimer = opts.disclaimerText.length > 120 ? opts.disclaimerText.slice(0, 117) + "…" : opts.disclaimerText;
    pdf.text(shortDisclaimer, 14, pageH - 6, { maxWidth: pageW - 28 });
  }

  pdf.setTextColor(0);
  pdf.setDrawColor(200);
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
  const totalPages = meta?.disclaimerText ? 4 : 3;

  const brandRgb = meta?.brandColor ? hexToRgb(meta.brandColor) : [59, 130, 246] as [number, number, number];

  // Pre-load logo
  let logoDataUrl: string | null = null;
  if (meta?.logoUrl) {
    logoDataUrl = await loadImageAsDataUrl(meta.logoUrl);
  }

  const footerOpts = { logoDataUrl, footerText: meta?.footerText, disclaimerText: meta?.disclaimerText, brandColor: meta?.brandColor };

  // ─── Page 1: Diagram + title block + legend ───
  pdf.setFontSize(20);
  pdf.text(structureName, 14, 16);
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  const subtitleParts = [];
  if (meta?.isScenario) {
    subtitleParts.push(`Scenario${meta.scenarioLabel ? `: ${meta.scenarioLabel}` : ""}`);
  }
  if (meta?.snapshotName) {
    subtitleParts.push(`Snapshot: ${meta.snapshotName}`);
    if (meta.snapshotCreatedAt) {
      subtitleParts.push(`as at ${new Date(meta.snapshotCreatedAt).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}`);
    }
  }
  subtitleParts.push(`${entities.length} entities · ${relationships.length} relationships`);
  subtitleParts.push(`Exported ${exportDate}`);
  if (meta?.userName) subtitleParts.push(`by ${meta.userName}`);
  if (meta?.tenantName) subtitleParts.push(meta.tenantName);
  pdf.text(subtitleParts.join("  |  "), 14, 23);
  pdf.setTextColor(0);

  // Brand accent line under title
  if (meta?.brandColor) {
    pdf.setDrawColor(...brandRgb);
    pdf.setLineWidth(0.5);
    pdf.line(14, 26, pageW - 14, 26);
    pdf.setLineWidth(0.2);
    pdf.setDrawColor(200);
  }

  // Logo top-right on page 1
  if (logoDataUrl) {
    try {
      const dims = await getImageDims(logoDataUrl);
      const maxH = 14;
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
    const imgH = pageH - 76;
    pdf.addImage(imgData, "PNG", 14, 28, imgW, imgH);
  } catch {
    pdf.setFontSize(10);
    pdf.text("(Could not render diagram image)", 14, 40);
  }

  // Disclaimer box on page 1 if enabled
  if (meta?.disclaimerText) {
    const disclaimerY = pageH - 44;
    pdf.setDrawColor(...brandRgb);
    pdf.setFillColor(248, 248, 252);
    pdf.roundedRect(14, disclaimerY - 8, pageW - 28, 16, 1, 1, "FD");
    pdf.setFontSize(6.5);
    pdf.setTextColor(100);
    pdf.setFont("helvetica", "bold");
    pdf.text("DISCLAIMER", 16, disclaimerY - 4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    const wrappedDisclaimer = pdf.splitTextToSize(meta.disclaimerText, pageW - 34);
    pdf.text(wrappedDisclaimer.slice(0, 3), 16, disclaimerY);
    pdf.setTextColor(0);
    pdf.setDrawColor(200);
  }

  // Legend
  const legendStartY = meta?.disclaimerText ? pageH - 52 : pageH - 44;
  const leftItems: { title?: string; type: string; color: string }[] = [];
  const rightItems: { title?: string; type: string; color: string }[] = [];

  for (const group of LEGEND_GROUPS.slice(0, 2)) {
    leftItems.push({ title: group.title, type: "", color: "" });
    for (const t of group.types) leftItems.push({ type: t, color: EDGE_COLORS[t] ?? "#94a3b8" });
  }
  for (const group of LEGEND_GROUPS.slice(2)) {
    rightItems.push({ title: group.title, type: "", color: "" });
    for (const t of group.types) rightItems.push({ type: t, color: EDGE_COLORS[t] ?? "#94a3b8" });
  }

  const maxLen = Math.max(leftItems.length, rightItems.length);
  while (leftItems.length < maxLen) leftItems.push({ type: "", color: "" });
  while (rightItems.length < maxLen) rightItems.push({ type: "", color: "" });

  const panelH = maxLen * 4 + 4;
  pdf.setDrawColor(210);
  pdf.setFillColor(248, 248, 250);
  pdf.roundedRect(14, legendStartY - 2, pageW - 28, panelH, 2, 2, "FD");

  const col1X = 18;
  const col2X = 18 + (pageW - 36) / 2;
  let y = legendStartY + 2;

  for (let i = 0; i < maxLen; i++) {
    const left = leftItems[i];
    const right = rightItems[i];
    for (const [item, x] of [[left, col1X], [right, col2X]] as const) {
      if (!item || (!item.type && !item.title)) continue;
      if (item.title) {
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(100);
        pdf.text(item.title, x, y);
        pdf.setFont("helvetica", "normal");
      } else if (item.type && item.color) {
        const [r, g, b] = hexToRgb(item.color);
        pdf.setFillColor(r, g, b);
        pdf.rect(x + 2, y - 2, 5, 2.5, "F");
        pdf.setFontSize(7);
        pdf.setTextColor(60);
        pdf.text(capitalize(item.type), x + 9, y);
      }
    }
    y += 4;
  }

  pdf.setTextColor(0);
  addFooter(pdf, structureName, 1, totalPages, footerOpts);

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
      pct: r.ownership_percent,
      units: r.ownership_units,
      cls: r.ownership_class,
    };
  });
  relRows.sort((a, b) => relSortKey(a).localeCompare(relSortKey(b)));

  const hasPct = relRows.some((r) => r.pct != null);
  const hasUnits = relRows.some((r) => r.units != null);
  const hasCls = relRows.some((r) => r.cls != null);

  const relHead = ["From", "Relationship", "To"];
  if (hasPct) relHead.push("Ownership %");
  if (hasUnits) relHead.push("Units");
  if (hasCls) relHead.push("Class");

  const relBody = relRows.map((r) => {
    const row = [r.fromName, capitalize(r.relType), r.toName];
    if (hasPct) row.push(r.pct != null ? fmtPercent(r.pct) : "–");
    if (hasUnits) row.push(r.units != null ? String(r.units) : "–");
    if (hasCls) row.push(r.cls ?? "–");
    return row;
  });

  const relColStyles: Record<number, { halign: "right" | "left" | "center" }> = {};
  let colIdx = 3;
  if (hasPct) { relColStyles[colIdx] = { halign: "right" }; colIdx++; }
  if (hasUnits) { relColStyles[colIdx] = { halign: "right" }; colIdx++; }

  autoTable(pdf, {
    startY: 22,
    head: [relHead],
    body: relBody,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: brandRgb, fontSize: 9 },
    columnStyles: relColStyles,
    alternateRowStyles: { fillColor: [248, 248, 252] },
  });
  addFooter(pdf, structureName, 2, totalPages, footerOpts);

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
    const row = [
      e.name,
      getEntityLabel(e.entity_type),
      e.is_operating_entity ? "Yes" : "No",
      e.is_trustee_company ? "Yes" : "",
    ];
    if (hasAbn) row.push(e.abn ?? "");
    if (hasAcn) row.push(e.acn ?? "");
    return row;
  });

  autoTable(pdf, {
    startY: 22,
    head: [entHead],
    body: entBody,
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: brandRgb, fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 248, 252] },
  });
  addFooter(pdf, structureName, 3, totalPages, footerOpts);

  pdf.save(`${structureName.replace(/\s+/g, "_")}_pack.pdf`);
}
