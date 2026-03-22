import { HeartPulse, AlertTriangle, AlertCircle } from "lucide-react";
import { getHealthStatus } from "@/lib/structureScoring";
import type { HealthScoreV2 } from "@/lib/structureScoring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  health: HealthScoreV2;
  onClick: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400",
};

export default function CanvasHealthBadge({ health, onClick }: Props) {
  const status = getHealthStatus(health.score);
  const criticalCount = health.issues.filter((i) => i.severity === "critical").length;
  const warningCount = health.issues.filter((i) => i.severity !== "critical" && i.severity !== "info").length;

  const summaryParts: string[] = [];
  if (criticalCount > 0) summaryParts.push(`${criticalCount} critical`);
  if (warningCount > 0) summaryParts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
  const summaryText = summaryParts.length > 0 ? ` (${summaryParts.join(", ")})` : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border bg-background/80 backdrop-blur-sm px-3 py-1.5 text-xs font-medium shadow-sm hover:shadow-md transition-all cursor-pointer select-none ${STATUS_STYLES[status]}`}
        >
          <HeartPulse className="h-3.5 w-3.5" />
          <span className="tabular-nums">{health.score}</span>
          {criticalCount > 0 && <AlertCircle className="h-3 w-3 text-red-500" />}
          {warningCount > 0 && criticalCount === 0 && <AlertTriangle className="h-3 w-3 text-amber-500" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-xs text-xs">
        <p className="font-semibold">Health: {health.score}/100 — {health.label}</p>
        {summaryText && <p className="text-muted-foreground">{summaryText}</p>}
        <p className="text-muted-foreground mt-1">Click to view details</p>
      </TooltipContent>
    </Tooltip>
  );
}
