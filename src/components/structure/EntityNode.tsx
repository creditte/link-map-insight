import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin } from "lucide-react";
import { getEntityIcon, getEntityColor, getEntityLabel } from "@/lib/entityTypes";

function EntityNodeComponent({ data, selected }: NodeProps) {
  const entityType = (data.entity_type as string) ?? "Unclassified";
  const pinned = data.pinned as boolean;
  const Icon = getEntityIcon(entityType);
  const colorClass = getEntityColor(entityType);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`rounded-lg border-2 px-4 py-3 shadow-sm transition-shadow ${colorClass} ${
          selected ? "ring-2 ring-ring shadow-md" : ""
        }`}
        style={{ minWidth: 140 }}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 opacity-70" />
          <span className="text-sm font-medium leading-tight">{data.label as string}</span>
          {pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wider opacity-50">{getEntityLabel(entityType)}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export default memo(EntityNodeComponent);
