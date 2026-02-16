import { useState } from "react";
import { ChevronDown, ChevronRight, HeartPulse, XCircle, AlertTriangle, Info, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StructureHealth, ValidationIssue } from "@/hooks/useStructureData";

interface Props {
  health: StructureHealth;
  onSelectEntity?: (entityId: string) => void;
}

const STATUS_COLORS: Record<StructureHealth["status"], string> = {
  good: "bg-primary text-primary-foreground",
  warning: "bg-secondary text-secondary-foreground",
  critical: "bg-destructive text-destructive-foreground",
};

const STATUS_LABELS: Record<StructureHealth["status"], string> = {
  good: "Good",
  warning: "Warning",
  critical: "Critical",
};

const WHY_IT_MATTERS: Record<string, string> = {
  ownership_exceeds: "Total ownership over 100% indicates data entry errors that could affect reporting accuracy.",
  ownership_under: "Ownership below 100% may mean missing shareholders or incomplete records.",
  ownership_incomplete: "Mixed filled/blank percentages make it impossible to validate ownership totals.",
  ownership_no_percent: "No ownership percentages recorded — consider adding them for a complete picture.",
  missing_trustee: "Trusts require a trustee to be legally valid. This must be resolved before export.",
  missing_member: "SMSFs must have at least one member under superannuation law.",
  missing_shareholder: "Companies typically have shareholders. Verify this is intentional or add them.",
  circular_ownership: "Circular ownership chains create legal and tax complications and are usually data errors.",
  unclassified: "Unclassified entities can't be validated properly. Classify them to improve data quality.",
};

function IssueRow({ issue, onSelect }: { issue: ValidationIssue; onSelect?: (id: string) => void }) {
  const icon =
    issue.severity === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> :
    issue.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> :
    <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;

  const helper = WHY_IT_MATTERS[issue.code];

  return (
    <button
      className="flex flex-col gap-0.5 w-full text-left rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors"
      onClick={() => issue.entity_id && onSelect?.(issue.entity_id)}
      disabled={!issue.entity_id}
    >
      <div className="flex items-center gap-2 text-xs">
        {icon}
        <span className="flex-1 min-w-0 truncate">{issue.message}</span>
      </div>
      {helper && (
        <span className="text-[10px] text-muted-foreground pl-5 leading-tight">{helper}</span>
      )}
    </button>
  );
}

export default function StructureHealthPanel({ health, onSelectEntity }: Props) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const totalIssues = health.errors.length + health.warnings.length + health.info.length;
  const hasUnclassified = [...health.errors, ...health.warnings].some((i) => i.code === "unclassified");

  // Top 3 issues: errors first, then warnings
  const topIssues = [...health.errors, ...health.warnings, ...health.info].slice(0, 3);

  return (
    <div className="mt-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-xs font-normal"
        onClick={() => setExpanded((v) => !v)}
      >
        <HeartPulse className="h-3.5 w-3.5" />
        <span className="font-semibold">{health.score}/100</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[health.status]}`}>
          {STATUS_LABELS[health.status]}
        </Badge>
        {totalIssues > 0 && (
          <span className="text-muted-foreground ml-1">
            {health.errors.length > 0 && <span className="text-destructive font-semibold">{health.errors.length} error{health.errors.length !== 1 ? "s" : ""}</span>}
            {health.errors.length > 0 && health.warnings.length > 0 && ", "}
            {health.warnings.length > 0 && <span>{health.warnings.length} warning{health.warnings.length !== 1 ? "s" : ""}</span>}
          </span>
        )}
        {expanded ? <ChevronDown className="ml-auto h-3.5 w-3.5" /> : <ChevronRight className="ml-auto h-3.5 w-3.5" />}
      </Button>

      {expanded && totalIssues > 0 && (
        <div className="mt-1 rounded-md border bg-card p-2">
          {/* Top issues summary */}
          {topIssues.length > 0 && (
            <div className="mb-2 rounded-md bg-muted/50 px-2.5 py-2 space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Top issues</span>
              {topIssues.map((issue, idx) => (
                <div key={`top-${idx}`} className="flex items-center gap-1.5 text-xs">
                  {issue.severity === "error" ? <XCircle className="h-3 w-3 text-destructive shrink-0" /> : <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="truncate">{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Fix now CTA for unclassified */}
          {hasUnclassified && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full mb-2 gap-1.5 text-xs"
              onClick={() => navigate("/review?tab=duplicates")}
            >
              <Wrench className="h-3.5 w-3.5" />
              Fix now — classify unresolved entities
            </Button>
          )}

          <Tabs defaultValue={health.errors.length > 0 ? "errors" : "warnings"}>
            <TabsList className="h-7 w-full">
              <TabsTrigger value="errors" className="text-[10px] gap-1 flex-1" disabled={health.errors.length === 0}>
                Errors ({health.errors.length})
              </TabsTrigger>
              <TabsTrigger value="warnings" className="text-[10px] gap-1 flex-1" disabled={health.warnings.length === 0}>
                Warnings ({health.warnings.length})
              </TabsTrigger>
              <TabsTrigger value="info" className="text-[10px] gap-1 flex-1" disabled={health.info.length === 0}>
                Info ({health.info.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="errors" className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
              {health.errors.map((i, idx) => (
                <IssueRow key={`${i.code}-${i.entity_id}-${idx}`} issue={i} onSelect={onSelectEntity} />
              ))}
            </TabsContent>
            <TabsContent value="warnings" className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
              {health.warnings.map((i, idx) => (
                <IssueRow key={`${i.code}-${i.entity_id}-${idx}`} issue={i} onSelect={onSelectEntity} />
              ))}
            </TabsContent>
            <TabsContent value="info" className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
              {health.info.map((i, idx) => (
                <IssueRow key={`${i.code}-${i.entity_id}-${idx}`} issue={i} onSelect={onSelectEntity} />
              ))}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

/** Compact inline badge for the structures list page */
export function HealthBadge({ score, status }: { score: number; status: StructureHealth["status"] }) {
  return (
    <Badge className={`text-[10px] px-1.5 py-0 gap-1 ${STATUS_COLORS[status]}`}>
      <HeartPulse className="h-2.5 w-2.5" />
      {score}
    </Badge>
  );
}
