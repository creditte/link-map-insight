import { HeartPulse, AlertTriangle, AlertCircle, Wrench, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getHealthStatus } from "@/lib/structureScoring";
import type { HealthScoreV2 } from "@/lib/structureScoring";

interface Props {
  health: HealthScoreV2;
  onFixIssues: () => void;
  onViewDetails: () => void;
}

export default function CanvasHealthBar({ health, onFixIssues, onViewDetails }: Props) {
  const status = getHealthStatus(health.score);
  const criticalCount = health.issues.filter((i) => i.severity === "critical").length;
  const warningCount = health.issues.filter((i) => i.severity !== "critical" && i.severity !== "info").length;
  const totalFixable = health.issues.filter((i) => i.severity !== "info").length;

  if (totalFixable === 0 && health.score >= 90) return null;

  const statusConfig = {
    good: {
      bg: "bg-emerald-500/5 border-emerald-500/20",
      progressColor: "[&>div]:bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
    },
    warning: {
      bg: "bg-amber-500/5 border-amber-500/20",
      progressColor: "[&>div]:bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
    },
    critical: {
      bg: "bg-red-500/5 border-red-500/20",
      progressColor: "[&>div]:bg-red-500",
      text: "text-red-700 dark:text-red-400",
    },
  }[status];

  return (
    <div className={`absolute top-0 left-0 right-0 z-10 flex items-center gap-4 border-b px-4 py-2.5 backdrop-blur-md ${statusConfig.bg}`}>
      {/* Score */}
      <div className="flex items-center gap-2.5 shrink-0">
        <HeartPulse className={`h-4 w-4 ${statusConfig.text}`} />
        <span className={`text-sm font-semibold tabular-nums ${statusConfig.text}`}>
          Structure Health: {health.score}%
        </span>
      </div>

      {/* Progress bar */}
      <Progress value={health.score} className={`h-1.5 w-24 shrink-0 bg-muted/50 ${statusConfig.progressColor}`} />

      {/* Issue summary */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {criticalCount > 0 && (
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <AlertCircle className="h-3 w-3" />
            {criticalCount} critical
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            {warningCount} warning{warningCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      {totalFixable > 0 && (
        <Button variant="default" size="sm" className="h-7 gap-1.5 text-xs" onClick={onFixIssues}>
          <Wrench className="h-3 w-3" />
          Fix Issues
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={onViewDetails}>
        View Details
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}
