import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin, Star, Shield } from "lucide-react";
import { getEntityIcon, getEntityColor, getEntityLabel } from "@/lib/entityTypes";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NODE_WIDTH = 180;
const MAX_LINES_COLLAPSED = 4;

function EntityNodeComponent({ data, selected }: NodeProps) {
  const entityType = (data.entity_type as string) ?? "Unclassified";
  const pinned = data.pinned as boolean;
  const isOperating = data.is_operating_entity as boolean;
  const isTrusteeCompany = data.is_trustee_company as boolean;
  const Icon = getEntityIcon(entityType);
  const colorClass = getEntityColor(entityType);
  const label = data.label as string;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`relative rounded-lg border-2 px-4 py-3 shadow-sm transition-shadow ${colorClass} ${
                selected ? "ring-2 ring-ring shadow-md" : ""
              }`}
              style={{ width: NODE_WIDTH }}
            >
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
                  {isOperating && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
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
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export default memo(EntityNodeComponent);
