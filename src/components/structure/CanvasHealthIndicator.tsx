import { HeartPulse } from "lucide-react";
import { getHealthStatus } from "@/lib/structureScoring";
import type { HealthScoreV2 } from "@/lib/structureScoring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  health: HealthScoreV2;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  good: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400",
};

export default function CanvasHealthIndicator({ health, onClick }: Props) {
  const status = getHealthStatus(health.displayScore);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-all hover:shadow-md cursor-pointer select-none ${STATUS_COLORS[status]}`}
        >
          <HeartPulse className="h-3.5 w-3.5" />
          <span className="font-bold tabular-nums">{health.displayScore.toFixed(1)}</span>
          <span className="text-[10px] opacity-80">/ 10</span>
          <span className="hidden sm:inline text-[10px] opacity-70">— {health.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-xs text-xs">
        <p className="font-semibold mb-1">Structure Health: {health.displayScore.toFixed(1)} / 10 — {health.label}</p>
        <p className="text-muted-foreground">Click to review diagram</p>
        {health.isCapped && (
          <p className="text-amber-600 dark:text-amber-400 mt-1 text-[10px]">Score capped — corporate trustee required for full score</p>
        )}
        <p className="text-muted-foreground/60 mt-1 text-[10px] italic">
          Health Score reflects structural completeness and governance robustness. It does not assess tax outcomes.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
