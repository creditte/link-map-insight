import { useState } from "react";
import { ChevronDown, ChevronRight, HeartPulse, XCircle, AlertTriangle, Info } from "lucide-react";
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

function IssueRow({ issue, onSelect }: { issue: ValidationIssue; onSelect?: (id: string) => void }) {
  const icon =
    issue.severity === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> :
    issue.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> :
    <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;

  return (
    <button
      className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors"
      onClick={() => issue.entity_id && onSelect?.(issue.entity_id)}
      disabled={!issue.entity_id}
    >
      {icon}
      <span className="flex-1 min-w-0 truncate">{issue.message}</span>
    </button>
  );
}

export default function StructureHealthPanel({ health, onSelectEntity }: Props) {
  const [expanded, setExpanded] = useState(false);

  const totalIssues = health.errors.length + health.warnings.length + health.info.length;

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
