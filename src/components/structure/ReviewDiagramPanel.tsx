import { useState, useCallback, useEffect } from "react";
import { X, ChevronDown, ChevronRight, Sparkles, RefreshCw, HeartPulse, AlertTriangle, CheckCircle2, Wrench, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import type { HealthScoreV2, ScoringIssue } from "@/lib/structureScoring";
import { getHealthStatus } from "@/lib/structureScoring";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

const REVIEW_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-structure`;

interface Props {
  health: HealthScoreV2;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  structureName: string;
  structureId?: string;
  onClose: () => void;
  onSelectEntity?: (entityId: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  good: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  critical: "bg-red-500/10 text-red-700 border-red-500/20",
};

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-md">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold hover:bg-accent/50 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {icon}
        {title}
      </button>
      {open && <div className="px-3 pb-3 text-xs">{children}</div>}
    </div>
  );
}

function IssueList({
  issues,
  label,
  onSelect,
}: {
  issues: ScoringIssue[];
  label: string;
  onSelect?: (entityId: string) => void;
}) {
  if (issues.length === 0) return <p className="text-muted-foreground italic">No {label.toLowerCase()} identified.</p>;

  return (
    <ul className="space-y-1.5">
      {issues.map((issue, idx) => (
        <li key={`${issue.code}-${issue.entity_id}-${idx}`} className="flex items-start gap-1.5">
          {issue.severity === "critical" ? (
            <AlertTriangle className="h-3 w-3 shrink-0 text-red-500 mt-0.5" />
          ) : issue.severity === "gap" ? (
            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" />
          )}
          <button
            className={`text-left ${issue.entity_id ? "hover:underline hover:text-primary cursor-pointer" : "cursor-default"}`}
            disabled={!issue.entity_id}
            onClick={() => issue.entity_id && onSelect?.(issue.entity_id)}
          >
            {issue.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Parse markdown checkboxes into structured items ───
interface ChecklistItem {
  id: string;
  text: string;
}

function parseChecklistItems(markdown: string): ChecklistItem[] {
  const lines = markdown.split("\n");
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const match = line.match(/^[-*]\s*\[[ x]\]\s*(.+)/i);
    if (match) {
      const text = match[1].trim();
      items.push({ id: text.slice(0, 80), text });
    }
  }
  return items;
}

function getNonChecklistContent(markdown: string): string {
  const lines = markdown.split("\n");
  return lines
    .filter((line) => !line.match(/^[-*]\s*\[[ x]\]\s*.+/i))
    .join("\n")
    .trim();
}

// Persist checked items per structure in localStorage
function getCheckedKey(structureId: string) {
  return `review-checklist-${structureId}`;
}

function loadCheckedItems(structureId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getCheckedKey(structureId));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveCheckedItems(structureId: string, items: Set<string>) {
  localStorage.setItem(getCheckedKey(structureId), JSON.stringify([...items]));
}

function ImproveChecklist({
  markdown,
  structureId,
}: {
  markdown: string;
  structureId: string;
}) {
  const items = parseChecklistItems(markdown);
  const preamble = getNonChecklistContent(markdown);
  const [checked, setChecked] = useState<Set<string>>(() => loadCheckedItems(structureId));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCheckedItems(structureId, next);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {preamble && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
          <ReactMarkdown>{preamble}</ReactMarkdown>
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <Checkbox
                id={`chk-${item.id}`}
                checked={checked.has(item.id)}
                onCheckedChange={() => toggle(item.id)}
                className="mt-0.5"
              />
              <label
                htmlFor={`chk-${item.id}`}
                className={`cursor-pointer leading-relaxed ${checked.has(item.id) ? "line-through text-muted-foreground" : ""}`}
              >
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Loading skeleton for AI sections ───
function AiLoadingSkeleton() {
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Analysing structure…</span>
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-full rounded bg-muted animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
        <div className="h-3 w-3/5 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export default function ReviewDiagramPanel({ health, entities, relationships, structureName, structureId, onClose, onSelectEntity }: Props) {
  const { toast } = useToast();
  const status = getHealthStatus(health.score);

  // Panel width state
  const [expanded, setExpanded] = useState(false);

  // AI sections state
  const [explainContent, setExplainContent] = useState("");
  const [improveContent, setImproveContent] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHasRun, setAiHasRun] = useState(false);

  const runAiReview = useCallback(async () => {
    setAiLoading(true);
    setExplainContent("");
    setImproveContent("");
    setAiHasRun(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({ title: "Not authenticated", variant: "destructive" });
        setAiLoading(false);
        return;
      }

      // Build audit summary from deterministic engine
      const auditSummary = health.issues
        .map((i) => `- [${i.severity}] ${i.message}`)
        .join("\n");

      const resp = await fetch(REVIEW_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          entities,
          relationships,
          structureName,
          healthScore: health.score,
          healthLabel: health.label,
          auditSummary,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Review failed" }));
        toast({ title: "Review failed", description: err.error, variant: "destructive" });
        setAiLoading(false);
        return;
      }

      if (!resp.body) {
        setAiLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              accumulated += delta;
              const parts = splitSections(accumulated);
              setExplainContent(parts.explain);
              setImproveContent(parts.improve);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Flush
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              accumulated += delta;
              const parts = splitSections(accumulated);
              setExplainContent(parts.explain);
              setImproveContent(parts.improve);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error("Review error:", e);
      toast({ title: "Review failed", description: "Network error", variant: "destructive" });
    }

    setAiLoading(false);
  }, [entities, relationships, structureName, health, toast]);

  // Integrity checks summary
  const circularOwnership = health.issues.some((i) => i.code === "circular_ownership") ? "Yes" : "No";
  const orphanCount = health.issues.filter((i) => i.code === "orphan_entity").length;
  const missingOwnershipPct = health.issues.filter((i) => i.code === "missing_ownership_percent").length;
  const missingDirectors = health.issues.filter((i) => i.code === "missing_directors").length;
  const missingTrusteeLinks = health.issues.filter((i) => i.code === "missing_trustee" || i.code === "missing_appointer").length;

  const panelWidth = expanded ? "w-[880px]" : "w-[620px]";

  return (
    <div className={`absolute left-0 top-0 z-10 flex h-full ${panelWidth} flex-col border-r bg-card shadow-lg transition-all duration-200`}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Review Diagram</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Collapse panel" : "Expand panel"}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* ─── Always-visible Snapshot ─── */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Entities: <strong className="text-foreground">{health.entityCount}</strong></span>
              <span>•</span>
              <span>Layers: <strong className="text-foreground">{health.depthEstimate}</strong></span>
              <span>•</span>
              <span>Control Chain: <strong className={health.controlChainStatus === "Confirmed" ? "text-emerald-600" : "text-amber-600"}>{health.controlChainStatus}</strong></span>
              <span>•</span>
              <span>Data Gaps: <strong className="text-foreground">{health.dataGapCount}</strong></span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tabular-nums">{health.score} / 100</span>
              <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[status]}`}>
                {health.label}
              </Badge>
              {health.isCapped && (
                <span className="text-[10px] text-amber-600">(capped)</span>
              )}
            </div>

            <p className="text-xs text-muted-foreground italic leading-relaxed">
              "{health.oneLiner}"
            </p>

            {/* Category breakdown */}
            <div className="grid grid-cols-4 gap-1 mt-2">
              {[
                { label: "Control", val: health.controlScore, max: 40 },
                { label: "Governance", val: health.governanceScore, max: 30 },
                { label: "Structural", val: health.structuralScore, max: 20 },
                { label: "Data", val: health.dataScore, max: 10 },
              ].map(({ label, val, max }) => (
                <div key={label} className="text-center">
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                  <div className="text-xs font-semibold tabular-nums">{val}/{max}</div>
                  <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(val / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* ─── AI Generate Button (shown when AI hasn't run yet) ─── */}
          {!aiHasRun && (
            <Button onClick={runAiReview} variant="outline" size="sm" className="w-full gap-2" disabled={aiLoading}>
              {aiLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analysing structure…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Explain & Improve
                </>
              )}
            </Button>
          )}

          {/* ─── Expandable Sections ─── */}

          {/* 1) Explain (AI) */}
          <CollapsibleSection
            title="Explain"
            icon={<Sparkles className="h-3 w-3 text-primary" />}
            defaultOpen={!!explainContent}
          >
            {aiLoading && !explainContent ? (
              <AiLoadingSkeleton />
            ) : explainContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
                <ReactMarkdown>{explainContent}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-muted-foreground italic">
                Click 'Generate Explain & Improve' to populate.
              </p>
            )}
          </CollapsibleSection>

          {/* 2) Audit (Deterministic) */}
          <CollapsibleSection
            title="Audit"
            icon={<AlertTriangle className="h-3 w-3 text-amber-500" />}
          >
            <div className="space-y-3">
              {health.criticalGaps.length > 0 && (
                <div>
                  <p className="font-semibold text-red-600 mb-1">Critical Gaps</p>
                  <IssueList issues={health.criticalGaps} label="critical gaps" onSelect={onSelectEntity} />
                </div>
              )}

              {health.governanceGaps.length > 0 && (
                <div>
                  <p className="font-semibold text-amber-600 mb-1">Governance Gaps</p>
                  <IssueList issues={health.governanceGaps} label="governance gaps" onSelect={onSelectEntity} />
                </div>
              )}

              <div>
                <p className="font-semibold mb-1">Diagram Integrity</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Circular ownership detected: <strong className={circularOwnership === "Yes" ? "text-red-600" : "text-emerald-600"}>{circularOwnership}</strong></li>
                  <li>Orphan entities: <strong className={orphanCount > 0 ? "text-amber-600" : "text-emerald-600"}>{orphanCount > 0 ? `${orphanCount} found` : "None"}</strong></li>
                  <li>Missing ownership %: <strong className={missingOwnershipPct > 0 ? "text-amber-600" : "text-emerald-600"}>{missingOwnershipPct > 0 ? missingOwnershipPct : "None"}</strong></li>
                  <li>Missing directors: <strong className={missingDirectors > 0 ? "text-amber-600" : "text-emerald-600"}>{missingDirectors > 0 ? missingDirectors : "None"}</strong></li>
                  <li>Missing trustee/appointor links: <strong className={missingTrusteeLinks > 0 ? "text-red-600" : "text-emerald-600"}>{missingTrusteeLinks > 0 ? missingTrusteeLinks : "None"}</strong></li>
                </ul>
              </div>

              {health.isCapped && health.capReason && (
                <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                  {health.capReason}
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* 3) Improve (AI) */}
          <CollapsibleSection
            title="Improve"
            icon={<Wrench className="h-3 w-3 text-primary" />}
          >
            {aiLoading && !improveContent ? (
              <AiLoadingSkeleton />
            ) : improveContent && structureId ? (
              <ImproveChecklist markdown={improveContent} structureId={structureId} />
            ) : improveContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
                <ReactMarkdown>{improveContent}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-muted-foreground italic">
                Click 'Generate Explain & Improve' to populate.
              </p>
            )}
          </CollapsibleSection>

          {/* ─── Always-visible Re-run button ─── */}
          <Button
            onClick={runAiReview}
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-xs"
            disabled={aiLoading}
          >
            {aiLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {aiLoading ? "Running AI review…" : "Re-run AI review"}
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}

// Split AI output into Explain and Improve sections by heading markers
function splitSections(text: string): { explain: string; improve: string } {
  const explainMatch = text.match(/## Explain\s*\n([\s\S]*?)(?=## Improve|$)/i);
  const improveMatch = text.match(/## Improve\s*\n([\s\S]*?)$/i);

  if (explainMatch || improveMatch) {
    return {
      explain: (explainMatch?.[1] ?? "").trim(),
      improve: (improveMatch?.[1] ?? "").trim(),
    };
  }

  // If no headings yet, treat all as explain (still streaming)
  return { explain: text.trim(), improve: "" };
}
