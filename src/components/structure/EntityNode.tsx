import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin, Star } from "lucide-react";
import { getEntityIcon, getEntityColor, getEntityLabel } from "@/lib/entityTypes";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function EntityNodeComponent({ data, selected }: NodeProps) {
  const entityType = (data.entity_type as string) ?? "Unclassified";
  const pinned = data.pinned as boolean;
  const isOperating = data.is_operating_entity as boolean;
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
              className={`rounded-lg border-2 px-4 py-3 shadow-sm transition-shadow ${colorClass} ${
                selected ? "ring-2 ring-ring shadow-md" : ""
              }`}
              style={{ minWidth: 100, maxWidth: 180 }}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 opacity-70" />
                <span
                  className="text-sm font-medium leading-tight overflow-hidden"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    wordBreak: "break-word",
                  }}
                >
                  {label}
                </span>
                {isOperating && <Star className="h-3 w-3 shrink-0 text-amber-500 fill-amber-500" />}
                {pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider opacity-50 truncate">{getEntityLabel(entityType)}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[250px]">
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">{getEntityLabel(entityType)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export default memo(EntityNodeComponent);
