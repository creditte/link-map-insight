import { toPng, toSvg } from "html-to-image";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import type { HealthScoreV2 } from "@/lib/structureScoring";
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

const REL_DISPLAY_LABELS: Record<string, string> = { appointer: "Appointor" };
function capitalize(s: string): string {
  return REL_DISPLAY_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** Sanitise text: strip broken glyphs, control chars, replace fancy quotes/arrows */
function sanitise(s: string): string {
  return s
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/→|!'/g, "->")
    .replace(/&/g, "&")
    .replace(/[^\x20-\x7E\n\r\t]/g, ""); // strip non-ASCII
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
  { title: "Family / Membership", types: ["partner", "member", "spouse", "parent", "child"] },
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

/* ── Premium colour palette ── */
const C = {
  green: [22, 163, 74] as [number, number, number],
  greenLight: [220, 252, 231] as [number, number, number],
  greenMuted: [187, 247, 208] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
  body: [51, 65, 85] as [number, number, number],
  muted: [148, 163, 184] as [number, number, number],
  light: [241, 245, 249] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  red: [220, 38, 38] as [number, number, number],
  amber: [217, 119, 6] as [number, number, number],
  amberLight: [254, 243, 199] as [number, number, number],
  redLight: [254, 226, 226] as [number, number, number],
};

/* ── Shared page layout helpers ── */

const MM_MARGIN = 14;

function addPremiumFooter(
  pdf: jsPDF,
  groupName: string,
  pageNum: number,
  totalPages: number,
  opts?: { logoDataUrl?: string | null; brandColor?: string }
) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  pdf.setDrawColor(...C.border);
  pdf.setLineWidth(0.3);
  pdf.line(MM_MARGIN, pageH - 14, pageW - MM_MARGIN, pageH - 14);

  pdf.setFontSize(7);
  pdf.setTextColor(...C.muted);
  pdf.text(sanitise(groupName), MM_MARGIN, pageH - 9);
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageW - MM_MARGIN, pageH - 9, { align: "right" });

  if (opts?.logoDataUrl && pageNum > 1) {
    try {
      pdf.addImage(opts.logoDataUrl, "PNG", pageW / 2 - 8, pageH - 13, 16, 6);
    } catch { /* skip */ }
  }

  pdf.setTextColor(0);
}

function sectionTitle(pdf: jsPDF, text: string, y: number, brandRgb?: [number, number, number]): number {
  const accent = brandRgb ?? C.green;
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...C.dark);
  pdf.text(text, MM_MARGIN, y);

  const tw = pdf.getTextWidth(text);
  pdf.setDrawColor(...accent);
  pdf.setLineWidth(0.8);
  pdf.line(MM_MARGIN, y + 1.5, MM_MARGIN + tw + 2, y + 1.5);
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(...C.border);
  pdf.setFont("helvetica", "normal");

  return y + 8;
}

function drawMetricBar(
  pdf: jsPDF,
  x: number, y: number, w: number,
  label: string, value: number, max: number,
  accent: [number, number, number]
) {
  const pct = Math.min(1, value / max);
  const barH = 4;

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...C.body);
  pdf.text(label, x, y);
  pdf.text(`${value}/${max}`, x + w, y, { align: "right" });

  pdf.setFillColor(...C.light);
  pdf.roundedRect(x, y + 1.5, w, barH, 1.5, 1.5, "F");

  if (pct > 0) {
    const fillColor: [number, number, number] = pct >= 0.9 ? C.green : pct >= 0.5 ? C.amber : C.red;
    pdf.setFillColor(...fillColor);
    pdf.roundedRect(x, y + 1.5, Math.max(3, w * pct), barH, 1.5, 1.5, "F");
  }

  return y + barH + 8;
}

function getScoreColor(score: number): [number, number, number] {
  if (score >= 90) return C.green;
  if (score >= 50) return C.amber;
  return C.red;
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Minor Gaps";
  if (score >= 50) return "Control Incomplete";
  if (score >= 30) return "Governance Gaps";
  return "Critical Issues";
}

/* ── Advisory text generators ── */

function generateAdvisory(issues: import("@/lib/structureScoring").ScoringIssue[], score: number): string {
  if (score >= 90) {
    return "This structure demonstrates strong governance and control arrangements. All key relationships are recorded and no critical gaps have been identified. Ongoing monitoring is recommended to maintain compliance as the structure evolves.";
  }
  if (score >= 70) {
    return "The structure is fundamentally sound with minor documentation gaps. Addressing the items above will bring the structure to full compliance and strengthen governance clarity for all stakeholders.";
  }
  if (score >= 50) {
    return "Material governance gaps exist that require attention. The issues identified relate to control clarity and may have implications for asset protection and succession planning. Remediation of priority items is recommended before the next review cycle.";
  }
  return "Critical structural and governance deficiencies have been identified. These gaps represent material risk to the integrity of the arrangement and should be addressed as a matter of urgency. Professional advisory review is strongly recommended.";
}

function generateRecommendations(issues: import("@/lib/structureScoring").ScoringIssue[]): { priority: number; action: string; impact: string }[] {
  const recs: { priority: number; action: string; impact: string }[] = [];
  const seen = new Set<string>();

  const criticals = issues.filter((i) => i.severity === "critical");
  const gaps = issues.filter((i) => i.severity === "gap");
  const minors = issues.filter((i) => i.severity === "minor" || i.severity === "info");

  const addUnique = (priority: number, issue: import("@/lib/structureScoring").ScoringIssue) => {
    const action = sanitise(issueToAction(issue));
    if (seen.has(action)) return;
    seen.add(action);
    recs.push({ priority, action, impact: sanitise(issueToImpact(issue)) });
  };

  for (const issue of criticals.slice(0, 4)) addUnique(1, issue);
  for (const issue of gaps.slice(0, 4)) addUnique(2, issue);
  for (const issue of minors.slice(0, 3)) addUnique(3, issue);
  return recs;
}

function issueToAction(issue: import("@/lib/structureScoring").ScoringIssue): string {
  const name = issue.entity_name ?? "the entity";
  switch (issue.code) {
    case "missing_trustee": return `Assign a trustee to "${name}"`;
    case "missing_appointer": return `Record an appointor for "${name}"`;
    case "missing_member": return `Add members to SMSF "${name}"`;
    case "missing_directors": return `Record directors for company "${name}"`;
    case "missing_shareholders": return `Add shareholders to company "${name}"`;
    case "missing_ownership_percent": return `Record ownership percentages for "${name}"`;
    case "ownership_exceeds": return `Correct ownership percentages for "${name}" (currently exceeds 100%)`;
    case "circular_ownership": return `Resolve circular ownership chain involving "${name}"`;
    case "orphan_entity": return `Connect "${name}" to the structure or remove if redundant`;
    case "duplicate_relationship": return `Remove duplicate relationship for "${name}"`;
    case "unclassified": return `Classify entity "${name}" with the correct type`;
    case "missing_identifiers": return `Add ABN or ACN for "${name}"`;
    case "no_corporate_trustee": return `Consider appointing a corporate trustee for "${name}"`;
    default: return issue.message;
  }
}

function issueToImpact(issue: import("@/lib/structureScoring").ScoringIssue): string {
  switch (issue.code) {
    case "missing_trustee": return "Without a trustee, the trust cannot legally administer assets or make distributions.";
    case "missing_appointer": return "An appointor controls who serves as trustee — this is a critical governance safeguard.";
    case "missing_member": return "SMSF members must be recorded to satisfy regulatory obligations.";
    case "missing_directors": return "Directors are legally required for company governance and ASIC compliance.";
    case "missing_shareholders": return "Shareholder records establish beneficial ownership and are required for compliance.";
    case "missing_ownership_percent": return "Ownership percentages are needed for tax reporting and distribution calculations.";
    case "ownership_exceeds": return "Ownership exceeding 100% indicates a data error that will affect reporting accuracy.";
    case "circular_ownership": return "Circular ownership creates legal ambiguity and may have adverse tax consequences.";
    case "orphan_entity": return "Disconnected entities reduce structural clarity and may indicate missing relationships.";
    case "duplicate_relationship": return "Duplicate entries can cause errors in reporting and governance assessments.";
    case "unclassified": return "Unclassified entities prevent accurate governance scoring and compliance checks.";
    case "missing_identifiers": return "ABN/ACN records are needed for regulatory correspondence and ATO compliance.";
    case "no_corporate_trustee": return "Corporate trustees provide limited liability protection and succession continuity.";
    default: return "Addressing this gap improves structural completeness and governance clarity.";
  }
}

/** Draw a filled circle dot for status columns */
function drawStatusDot(pdf: jsPDF, x: number, y: number, isYes: boolean) {
  const r = 1.4;
  if (isYes) {
    pdf.setFillColor(...C.green);
  } else {
    pdf.setFillColor(200, 200, 200);
  }
  pdf.circle(x, y, r, "F");
}

/* ── Main premium PDF export ── */

export interface PdfHealthOptions {
  includeHealthSummary?: boolean;
  healthScore?: HealthScoreV2;
  includeChecklist?: boolean;
}

export async function exportPdf(
  graphElement: HTMLElement,
  entities: EntityNode[],
  relationships: RelationshipEdge[],
  structureName: string,
  meta?: ExportMeta,
  healthOptions?: PdfHealthOptions
) {
  const exportDate = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  const brandRgb = meta?.brandColor ? hexToRgb(meta.brandColor) : C.green;

  const hasHealth = healthOptions?.includeHealthSummary && healthOptions.healthScore;
  const hasChecklist = healthOptions?.includeChecklist && healthOptions.healthScore;
  const hasRecommendations = hasHealth && healthOptions.healthScore!.issues.length > 0;

  // Page 1 is landscape, rest are portrait
  let totalPages = 3;
  if (hasHealth) totalPages++;
  if (hasChecklist) totalPages++;
  if (hasRecommendations) totalPages++;

  // Pre-load logo
  let logoDataUrl: string | null = null;
  if (meta?.logoUrl) {
    logoDataUrl = await loadImageAsDataUrl(meta.logoUrl);
  }
  const footerOpts = { logoDataUrl, brandColor: meta?.brandColor };
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — STRUCTURE OVERVIEW (LANDSCAPE A4)
  // ════════════════════════════════════════════════════════════════

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const p1W = pdf.internal.pageSize.getWidth();  // ~297
  const p1H = pdf.internal.pageSize.getHeight(); // ~210

  // Slim header band
  const headerH = 22;
  pdf.setFillColor(...C.dark);
  pdf.rect(0, 0, p1W, headerH, "F");

  // Group name
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...C.white);
  pdf.text(sanitise(structureName), MM_MARGIN, 12);

  // Logo top-right
  if (logoDataUrl) {
    try {
      const dims = await getImageDims(logoDataUrl);
      const maxH = 10;
      const scale = Math.min(1, maxH / dims.h, 40 / dims.w);
      const drawW = dims.w * scale;
      const drawH = dims.h * scale;
      pdf.addImage(logoDataUrl, "PNG", p1W - MM_MARGIN - drawW, 6, drawW, drawH);
    } catch { /* skip */ }
  }

  // Sub-line
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(200, 210, 220);
  const subParts = [
    `${entities.length} entities`,
    `${relationships.length} relationships`,
    `Exported ${exportDate}`,
  ];
  if (meta?.tenantName) subParts.push(sanitise(meta.tenantName));
  pdf.text(subParts.join("  |  "), MM_MARGIN, 18);

  // Accent bar
  pdf.setFillColor(...brandRgb);
  pdf.rect(0, headerH, p1W, 1, "F");

  // Diagram - maximise space
  const diagramTop = headerH + 3;
  const legendBandH = 20;
  const footerReserve = 16;
  const diagramH = p1H - diagramTop - legendBandH - footerReserve - 2;
  const diagramW = p1W - MM_MARGIN * 2;

  try {
    const imgData = await toPng(graphElement, { backgroundColor: "#ffffff", pixelRatio: 2 });
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.2);
    pdf.rect(MM_MARGIN, diagramTop, diagramW, diagramH, "S");
    pdf.addImage(imgData, "PNG", MM_MARGIN + 0.3, diagramTop + 0.3, diagramW - 0.6, diagramH - 0.6);
  } catch {
    pdf.setFontSize(10);
    pdf.setTextColor(...C.muted);
    pdf.text("(Could not render diagram image)", MM_MARGIN, diagramTop + 20);
  }

  // Legend band - fixed bottom, above footer
  const legendY = p1H - legendBandH - footerReserve;
  pdf.setFillColor(...C.light);
  pdf.setDrawColor(...C.border);
  pdf.roundedRect(MM_MARGIN, legendY, diagramW, legendBandH, 1.5, 1.5, "FD");

  const colW = (diagramW - 8) / 3;
  for (let gi = 0; gi < LEGEND_GROUPS.length; gi++) {
    const group = LEGEND_GROUPS[gi];
    const colX = MM_MARGIN + 4 + gi * colW;
    let ly = legendY + 5;

    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...C.dark);
    pdf.text(group.title, colX, ly);
    ly += 3.5;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    for (const t of group.types) {
      const color = EDGE_COLORS[t] ?? "#94a3b8";
      const [r, g, b] = hexToRgb(color);
      pdf.setFillColor(r, g, b);
      pdf.roundedRect(colX, ly - 2, 4, 2, 0.5, 0.5, "F");
      pdf.setTextColor(...C.body);
      pdf.text(capitalize(t), colX + 6, ly);
      ly += 3;
    }
  }

  // Disclaimer on page 1 if enabled
  if (meta?.disclaimerText) {
    const discY = legendY - 10;
    pdf.setDrawColor(...C.border);
    pdf.setFillColor(250, 250, 252);
    pdf.roundedRect(MM_MARGIN, discY - 2, diagramW, 8, 1, 1, "FD");
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...C.muted);
    pdf.text("DISCLAIMER", MM_MARGIN + 3, discY + 1);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(5.5);
    const wdisc = pdf.splitTextToSize(sanitise(meta.disclaimerText), diagramW - 8);
    pdf.text(wdisc.slice(0, 2), MM_MARGIN + 3, discY + 4);
  }

  pdf.setTextColor(0);
  addPremiumFooter(pdf, structureName, 1, totalPages, footerOpts);

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — RELATIONSHIPS (portrait)
  // ════════════════════════════════════════════════════════════════

  pdf.addPage("a4", "portrait");
  const pageW = 210; // A4 portrait width in mm
  const pageH = 297;
  let curY = sectionTitle(pdf, "Relationships", 18, brandRgb);

  const relRows = relationships.map((r) => {
    const from = entityMap.get(r.from_entity_id);
    const to = entityMap.get(r.to_entity_id);
    return {
      fromName: sanitise(from?.name ?? r.from_entity_id),
      relType: r.relationship_type,
      toName: sanitise(to?.name ?? r.to_entity_id),
      pct: r.ownership_percent,
    };
  });
  relRows.sort((a, b) => relSortKey(a).localeCompare(relSortKey(b)));

  const hasPct = relRows.some((r) => r.pct != null);

  const relHead = ["From", "Relationship", "To"];
  if (hasPct) relHead.push("Ownership %");

  const relBody = relRows.map((r) => {
    const row = [r.fromName, capitalize(r.relType), r.toName];
    if (hasPct) row.push(r.pct != null ? fmtPercent(r.pct) : "-");
    return row;
  });

  const relColStyles: Record<number, { halign: "right" | "left" | "center"; cellWidth?: number }> = {};
  if (hasPct) relColStyles[3] = { halign: "right" };

  autoTable(pdf, {
    startY: curY,
    head: [relHead],
    body: relBody,
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      textColor: C.body,
      lineColor: C.border,
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: C.dark,
      textColor: C.white,
      fontSize: 8,
      fontStyle: "bold",
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
    },
    columnStyles: relColStyles,
    alternateRowStyles: { fillColor: C.light },
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    tableLineColor: C.border,
  });
  addPremiumFooter(pdf, structureName, 2, totalPages, footerOpts);

  // ════════════════════════════════════════════════════════════════
  // PAGE 3 — ENTITIES (no % columns, green/grey dots)
  // ════════════════════════════════════════════════════════════════

  pdf.addPage("a4", "portrait");
  curY = sectionTitle(pdf, "Entities", 18, brandRgb);

  // Sub-header labels
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...C.muted);
  pdf.text("ENTITY DETAILS", MM_MARGIN, curY);
  pdf.text("STATUS", MM_MARGIN + 90, curY);
  curY += 3;

  const hasAbn = entities.some((e) => e.abn);
  const hasAcn = entities.some((e) => e.acn);

  const entHead = ["Name", "Type", "Operating", "Trustee Co."];
  if (hasAbn) entHead.push("ABN");
  if (hasAcn) entHead.push("ACN");

  // Use placeholder text; we'll draw dots in didDrawCell
  const entBody = entities.map((e) => {
    const row = [
      sanitise(e.name),
      getEntityLabel(e.entity_type),
      e.is_operating_entity ? "YES" : "NO",
      e.is_trustee_company ? "YES" : "NO",
    ];
    if (hasAbn) row.push(e.abn ?? "");
    if (hasAcn) row.push(e.acn ?? "");
    return row;
  });

  autoTable(pdf, {
    startY: curY,
    head: [entHead],
    body: entBody,
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      textColor: C.body,
      lineColor: C.border,
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: C.dark,
      textColor: C.white,
      fontSize: 8,
      fontStyle: "bold",
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
    },
    alternateRowStyles: { fillColor: C.light },
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    columnStyles: {
      2: { halign: "center", cellWidth: 18 },
      3: { halign: "center", cellWidth: 18 },
    },
    didParseCell: (data) => {
      // Hide the placeholder text for status columns - we draw dots instead
      if (data.section === "body" && (data.column.index === 2 || data.column.index === 3)) {
        data.cell.text = [""]; // clear text, we draw a dot in didDrawCell
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && (data.column.index === 2 || data.column.index === 3)) {
        const raw = data.cell.raw as string;
        const isYes = raw === "YES";
        const cx = data.cell.x + data.cell.width / 2;
        const cy = data.cell.y + data.cell.height / 2;
        drawStatusDot(pdf, cx, cy, isYes);
      }
    },
  });
  addPremiumFooter(pdf, structureName, 3, totalPages, footerOpts);

  let currentPage = 3;

  // ════════════════════════════════════════════════════════════════
  // PAGE 4 — STRUCTURE HEALTH SUMMARY
  // ════════════════════════════════════════════════════════════════

  if (hasHealth) {
    const hs = healthOptions.healthScore!;
    currentPage++;
    pdf.addPage("a4", "portrait");
    curY = sectionTitle(pdf, "Structure Health Summary", 18, brandRgb);

    const scoreBlockW = 55;
    const scoreBlockH = 40;
    const scoreColor = getScoreColor(hs.score);

    pdf.setFillColor(...C.light);
    pdf.setDrawColor(...scoreColor);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(MM_MARGIN, curY, scoreBlockW, scoreBlockH, 3, 3, "FD");
    pdf.setLineWidth(0.2);

    pdf.setFontSize(36);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...scoreColor);
    pdf.text(String(hs.score), MM_MARGIN + scoreBlockW / 2, curY + 18, { align: "center" });

    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...C.muted);
    pdf.text("Structure Health Score", MM_MARGIN + scoreBlockW / 2, curY + 24, { align: "center" });

    const statusLabel = getScoreLabel(hs.score);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...scoreColor);
    pdf.text(statusLabel, MM_MARGIN + scoreBlockW / 2, curY + 32, { align: "center" });

    // Metric bars
    const barX = MM_MARGIN + scoreBlockW + 12;
    const barW = pageW - barX - MM_MARGIN;
    let barY = curY + 4;

    const cats = [
      { label: "Control Integrity", val: hs.controlScore, max: 40 },
      { label: "Governance Completeness", val: hs.governanceScore, max: 30 },
      { label: "Structural Clarity", val: hs.structuralScore, max: 20 },
      { label: "Data Completeness", val: hs.dataScore, max: 10 },
    ];
    for (const cat of cats) {
      barY = drawMetricBar(pdf, barX, barY, barW, cat.label, cat.val, cat.max, brandRgb);
    }

    curY += scoreBlockH + 10;

    // Critical Gaps
    const critAndGap = hs.issues.filter((i) => i.severity === "critical" || i.severity === "gap").slice(0, 8);
    if (critAndGap.length > 0) {
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...C.dark);
      pdf.text("Critical Gaps Identified", MM_MARGIN, curY);
      curY += 6;

      for (let i = 0; i < critAndGap.length; i++) {
        const issue = critAndGap[i];
        const isCrit = issue.severity === "critical";

        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...(isCrit ? C.red : C.amber));
        pdf.text(`${i + 1}.`, MM_MARGIN, curY);
        pdf.setTextColor(...C.dark);
        pdf.text(sanitise(issue.message), MM_MARGIN + 6, curY);
        curY += 4;

        const impact = sanitise(issueToImpact(issue));
        pdf.setFontSize(7.5);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...C.body);
        const wrapped = pdf.splitTextToSize(impact, pageW - MM_MARGIN * 2 - 8);
        pdf.text(wrapped, MM_MARGIN + 6, curY);
        curY += wrapped.length * 3.5 + 3;

        if (curY > pageH - 40) break;
      }
    }

    // Advisory summary
    curY = Math.max(curY, pageH - 38);
    pdf.setDrawColor(...C.border);
    pdf.setFillColor(250, 252, 250);
    const advBoxH = 18;
    pdf.roundedRect(MM_MARGIN, curY, pageW - MM_MARGIN * 2, advBoxH, 1.5, 1.5, "FD");

    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...C.green);
    pdf.text("ADVISORY SUMMARY", MM_MARGIN + 4, curY + 4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...C.body);
    const advisory = generateAdvisory(hs.issues, hs.score);
    const advWrapped = pdf.splitTextToSize(advisory, pageW - MM_MARGIN * 2 - 10);
    pdf.text(advWrapped.slice(0, 3), MM_MARGIN + 4, curY + 8);

    addPremiumFooter(pdf, structureName, currentPage, totalPages, footerOpts);
  }

  // ════════════════════════════════════════════════════════════════
  // PAGE 5 — GOVERNANCE CHECKLIST
  // ════════════════════════════════════════════════════════════════

  if (hasChecklist) {
    const hs = healthOptions.healthScore!;
    currentPage++;
    pdf.addPage("a4", "portrait");
    curY = sectionTitle(pdf, "Governance Checklist", 18, brandRgb);

    const categories: { label: string; key: string }[] = [
      { label: "Control", key: "control" },
      { label: "Ownership", key: "governance" },
      { label: "Compliance", key: "structural" },
      { label: "Data Completeness", key: "data" },
    ];

    // Build pass items
    const passItems: { category: string; text: string }[] = [];
    if (!hs.issues.some((i) => i.code === "circular_ownership")) {
      passItems.push({ category: "control", text: "No circular ownership detected" });
    }
    if (!hs.issues.some((i) => i.code === "missing_trustee")) {
      passItems.push({ category: "control", text: "All trusts have trustees assigned" });
    }
    if (!hs.issues.some((i) => i.code === "missing_directors")) {
      passItems.push({ category: "governance", text: "All companies have directors recorded" });
    }
    if (!hs.issues.some((i) => i.code === "orphan_entity")) {
      passItems.push({ category: "structural", text: "No orphan entities in structure" });
    }

    for (const cat of categories) {
      const catIssues = hs.issues.filter((i) => i.category === cat.key);
      const catPassed = passItems.filter((p) => p.category === cat.key);
      if (catIssues.length === 0 && catPassed.length === 0) continue;

      // Category header
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...C.dark);
      pdf.text(cat.label, MM_MARGIN, curY);
      curY += 5;

      // Pass items: [checkmark] COMPLETE - description
      for (const item of catPassed) {
        // Severity pill FIRST (at start of line)
        pdf.setFillColor(...C.greenLight);
        pdf.roundedRect(MM_MARGIN + 2, curY - 2.5, 18, 4, 1, 1, "F");
        pdf.setFontSize(5.5);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...C.green);
        pdf.text("COMPLETE", MM_MARGIN + 11, curY, { align: "center" });

        // Check mark (safe ASCII)
        pdf.setFontSize(8);
        pdf.setTextColor(...C.green);
        pdf.text("[/]", MM_MARGIN + 22, curY);

        // Description
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...C.body);
        pdf.text(sanitise(item.text), MM_MARGIN + 30, curY);

        curY += 5.5;
      }

      // Fail items: [severity] [!] description
      for (const issue of catIssues) {
        if (curY > pageH - 25) break;

        const isCrit = issue.severity === "critical";
        const sevLabel = isCrit ? "HIGH" : issue.severity === "gap" ? "MEDIUM" : "LOW";
        const sevColor = isCrit ? C.red : issue.severity === "gap" ? C.amber : C.muted;
        const sevBg = isCrit ? C.redLight : issue.severity === "gap" ? C.amberLight : C.light;

        // Severity pill FIRST
        pdf.setFillColor(...sevBg);
        pdf.roundedRect(MM_MARGIN + 2, curY - 2.5, 18, 4, 1, 1, "F");
        pdf.setFontSize(5.5);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...sevColor);
        pdf.text(sevLabel, MM_MARGIN + 11, curY, { align: "center" });

        // Warning mark (safe ASCII)
        pdf.setFontSize(8);
        pdf.setTextColor(...sevColor);
        pdf.text("[!]", MM_MARGIN + 22, curY);

        // Description
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...C.body);
        pdf.text(sanitise(issue.message), MM_MARGIN + 30, curY, { maxWidth: pageW - MM_MARGIN * 2 - 35 });

        curY += 5.5;
      }

      curY += 3;
    }

    addPremiumFooter(pdf, structureName, currentPage, totalPages, footerOpts);
  }

  // ════════════════════════════════════════════════════════════════
  // PAGE 6 — RECOMMENDED ACTIONS
  // ════════════════════════════════════════════════════════════════

  if (hasRecommendations) {
    const hs = healthOptions.healthScore!;
    currentPage++;
    pdf.addPage("a4", "portrait");
    curY = sectionTitle(pdf, "Recommended Actions", 18, brandRgb);

    const recs = generateRecommendations(hs.issues);
    const priorities = [1, 2, 3];
    const priorityLabels = ["Priority 1 - Immediate", "Priority 2 - Short Term", "Priority 3 - Improvement"];
    const priorityColors: [number, number, number][] = [C.red, C.amber, C.muted];

    for (let pi = 0; pi < priorities.length; pi++) {
      const items = recs.filter((r) => r.priority === priorities[pi]);
      if (items.length === 0) continue;

      const pc = priorityColors[pi];
      pdf.setFillColor(...pc);
      pdf.roundedRect(MM_MARGIN, curY - 2, 3, 5, 0.5, 0.5, "F");

      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...C.dark);
      pdf.text(priorityLabels[pi], MM_MARGIN + 6, curY + 1.5);
      curY += 8;

      for (const rec of items) {
        if (curY > pageH - 30) break;

        // Action statement with safe arrow
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...C.dark);
        pdf.text("->", MM_MARGIN + 2, curY);
        pdf.text(sanitise(rec.action), MM_MARGIN + 10, curY);
        curY += 4;

        // Impact
        pdf.setFontSize(7.5);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...C.body);
        const impactWrapped = pdf.splitTextToSize(sanitise(rec.impact), pageW - MM_MARGIN * 2 - 12);
        pdf.text(impactWrapped, MM_MARGIN + 10, curY);
        curY += impactWrapped.length * 3.5 + 4;
      }

      curY += 4;
    }

    // Advisory tone footer
    const noteY = Math.max(curY + 4, pageH - 34);
    pdf.setDrawColor(...C.border);
    pdf.setFillColor(250, 250, 252);
    pdf.roundedRect(MM_MARGIN, noteY, pageW - MM_MARGIN * 2, 12, 1.5, 1.5, "FD");
    pdf.setFontSize(6.5);
    pdf.setFont("helvetica", "italic");
    pdf.setTextColor(...C.muted);
    pdf.text(
      "This report is generated based on recorded structural data and does not constitute legal, tax, or financial advice. Professional advisory review is recommended.",
      MM_MARGIN + 4, noteY + 5,
      { maxWidth: pageW - MM_MARGIN * 2 - 8 }
    );

    addPremiumFooter(pdf, structureName, currentPage, totalPages, footerOpts);
  }

  pdf.save(`${structureName.replace(/\s+/g, "_")}_pack.pdf`);
}
