import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Building2, User, Landmark, Users, Store, Building } from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  Individual: User,
  Company: Building2,
  Trust: Landmark,
  Partnership: Users,
  "Sole Trader": Store,
  "Incorporated Association/Club": Building,
  Unclassified: User,
};

const colorMap: Record<string, string> = {
  Individual: "bg-blue-50 border-blue-300 dark:bg-blue-950 dark:border-blue-700",
  Company: "bg-emerald-50 border-emerald-300 dark:bg-emerald-950 dark:border-emerald-700",
  Trust: "bg-amber-50 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  Partnership: "bg-purple-50 border-purple-300 dark:bg-purple-950 dark:border-purple-700",
  "Sole Trader": "bg-rose-50 border-rose-300 dark:bg-rose-950 dark:border-rose-700",
  "Incorporated Association/Club": "bg-cyan-50 border-cyan-300 dark:bg-cyan-950 dark:border-cyan-700",
  Unclassified: "bg-muted border-border",
};

function EntityNodeComponent({ data, selected }: NodeProps) {
  const entityType = (data.entity_type as string) ?? "Unclassified";
  const Icon = iconMap[entityType] ?? User;
  const colorClass = colorMap[entityType] ?? colorMap.Unclassified;

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
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wider opacity-50">{entityType}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export default memo(EntityNodeComponent);
