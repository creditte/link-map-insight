import { useEffect, useRef } from "react";
import { Plus, Trash2, Link2 } from "lucide-react";

export type ContextMenuType = "pane" | "node" | "edge";

export interface ContextMenuState {
  type: ContextMenuType;
  x: number;
  y: number;
  nodeId?: string;
  nodeName?: string;
  edgeId?: string;
  edgeLabel?: string;
  /** React Flow position for pane clicks (for placing new entities) */
  flowPosition?: { x: number; y: number };
}

interface Props {
  menu: ContextMenuState;
  onClose: () => void;
  onAddEntity: (flowPosition?: { x: number; y: number }) => void;
  onAddRelationship: (nodeId: string) => void;
  onRemoveEntity: (nodeId: string) => void;
  onRemoveRelationship: (edgeId: string) => void;
}

export default function StructureContextMenu({
  menu, onClose, onAddEntity, onAddRelationship, onRemoveEntity, onRemoveRelationship,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: { label: string; icon: React.ReactNode; action: () => void; variant?: "destructive" }[] = [];

  if (menu.type === "pane") {
    items.push({
      label: "Add Entity",
      icon: <Plus className="h-3.5 w-3.5" />,
      action: () => { onAddEntity(menu.flowPosition); onClose(); },
    });
  }

  if (menu.type === "node") {
    items.push({
      label: "Add Relationship",
      icon: <Link2 className="h-3.5 w-3.5" />,
      action: () => { onAddRelationship(menu.nodeId!); onClose(); },
    });
    items.push({
      label: "Remove Entity",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      action: () => { onRemoveEntity(menu.nodeId!); onClose(); },
      variant: "destructive",
    });
  }

  if (menu.type === "edge") {
    items.push({
      label: "Remove Relationship",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      action: () => { onRemoveRelationship(menu.edgeId!); onClose(); },
      variant: "destructive",
    });
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.type === "node" && menu.nodeName && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate max-w-[200px]">
          {menu.nodeName}
        </div>
      )}
      {menu.type === "edge" && menu.edgeLabel && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate max-w-[200px]">
          {menu.edgeLabel}
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.label}
          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
            item.variant === "destructive" ? "text-destructive hover:text-destructive" : ""
          }`}
          onClick={item.action}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
