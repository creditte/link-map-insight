import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin, Star, Shield, Briefcase, AlertCircle, AlertTriangle } from "lucide-react";
import { getEntityIcon, getEntityColor, getEntityLabel } from "@/lib/entityTypes";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NODE_WIDTH = 180;
const MAX_LINES_COLLAPSED = 4;

function EntityNodeComponent({ data, selected }: NodeProps) {
  const entityType = (data.entity_type as string) ?? "Unclassified";
  const pinned = data.pinned as boolean;
  const isOperating = data.is_operating_entity as boolean;
  const isTrusteeCompany = data.is_trustee_company as boolean;
  const isInvestmentCompany = data.is_investment_company as boolean;
  const issueSeverity = data.issueSeverity as string | undefined;
  const issueTooltip = data.issueTooltip as string | undefined;
  const Icon = getEntityIcon(entityType);
  const colorClass = getEntityColor(entityType);
  const label = data.label as string;
  const [hovered, setHovered] = useState(false);

  const issueOutline = issueSeverity === "critical"
    ? "ring-2 ring-red-500/60 ring-offset-1 ring-offset-card"
    : issueSeverity === "warning"
    ? "ring-2 ring-amber-500/50 ring-offset-1 ring-offset-card"
    : "";

  const handleClass = hovered || selected
    ? "!bg-primary !w-3 !h-3 !border-2 !border-background transition-all"
    : "!bg-muted-foreground !w-2 !h-2 !opacity-0 transition-all";

  return (
    <>
      <Handle type="target" position={Position.Top} className={handleClass} />
      <Handle type="source" position={Position.Bottom} className={handleClass} id="bottom" />
      <Handle type="source" position={Position.Left} className={handleClass} id="left" />
      <Handle type="source" position={Position.Right} className={handleClass} id="right" />
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              className={`relative rounded-lg border-2 px-4 py-3 pb-4 shadow-sm transition-shadow ${colorClass} ${
                selected ? "ring-2 ring-ring shadow-md" : issueOutline
              } ${issueSeverity === "critical" && !selected ? "animate-pulse-subtle" : ""}`}
              style={{ width: NODE_WIDTH }}
            >
              {/* Issue indicator dot */}
              {issueSeverity && !selected && (
                <div className={`absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full shadow-sm ${
                  issueSeverity === "critical" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                }`}>
                  {issueSeverity === "critical"
                    ? <AlertCircle className="h-3 w-3" />
                    : <AlertTriangle className="h-3 w-3" />
                  }
                </div>
              )}

              {/* Trustee Company badge */}
              {isTrusteeCompany && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500 text-white shadow-sm">
                        <Shield className="h-3 w-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Trustee Company
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* Investment/Bucket Company badge */}
              {isInvestmentCompany && !isTrusteeCompany && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-white shadow-sm">
                        <Briefcase className="h-3 w-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Investment / Bucket Company
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {isInvestmentCompany && isTrusteeCompany && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -top-1.5 right-4 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-white shadow-sm">
                        <Briefcase className="h-3 w-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Investment / Bucket Company
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <div className="flex items-start gap-2">
                <Icon className="h-4 w-4 shrink-0 opacity-70 mt-0.5" />
                <span
                  className="text-sm font-medium leading-tight overflow-hidden"
                  style={
                    selected
                      ? { wordBreak: "break-word" }
                      : {
                          display: "-webkit-box",
                          WebkitLineClamp: MAX_LINES_COLLAPSED,
                          WebkitBoxOrient: "vertical",
                          wordBreak: "break-word",
                        }
                  }
                >
                  {label}
                </span>
                <div className="flex shrink-0 items-center gap-0.5 mt-0.5">
                  {isOperating && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Primary entity
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {pinned && <Pin className="h-3 w-3 text-muted-foreground" />}
                </div>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider opacity-50 truncate">{getEntityLabel(entityType)}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[250px]">
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">
              {getEntityLabel(entityType)}
              {isTrusteeCompany && " · Trustee Company"}
              {isInvestmentCompany && " · Investment Company"}
            </p>
            {issueTooltip && (
              <p className={`text-xs mt-1 ${issueSeverity === "critical" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                ⚠ {issueTooltip}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}

export default memo(EntityNodeComponent);
