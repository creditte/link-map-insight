import { useState } from "react";
import { Plus, X, Sparkles, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onAddEntity: () => void;
  onAiAssist: () => void;
  showAiPanel: boolean;
  disabled?: boolean;
}

export default function FloatingActions({ onAddEntity, onAiAssist, showAiPanel, disabled }: Props) {
  const [open, setOpen] = useState(false);

  const actions = [
    {
      label: "Add Entity",
      icon: <Building2 className="h-4 w-4" />,
      onClick: () => { onAddEntity(); setOpen(false); },
    },
    {
      label: "AI Assist",
      icon: <Sparkles className="h-4 w-4" />,
      onClick: () => { onAiAssist(); setOpen(false); },
      active: showAiPanel,
    },
  ];

  return (
    <div
      className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Speed-dial items */}
      <div
        className={`flex flex-col items-end gap-2 transition-all duration-200 ${
          open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
        }`}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={disabled}
            className={`flex items-center gap-2.5 rounded-full pl-4 pr-3 py-2 shadow-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              action.active
                ? "bg-secondary text-secondary-foreground"
                : "bg-card text-foreground border border-border hover:bg-accent"
            }`}
          >
            <span>{action.label}</span>
            {action.icon}
          </button>
        ))}
      </div>

      {/* Main FAB */}
      <Button
        size="lg"
        className="h-12 w-12 rounded-full shadow-lg transition-transform duration-200"
        style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
        onClick={() => setOpen(!open)}
        disabled={disabled}
      >
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  );
}
