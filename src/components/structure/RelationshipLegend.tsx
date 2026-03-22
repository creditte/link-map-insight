import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Star, AlertCircle, AlertTriangle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const EDGE_COLORS: Record<string, string> = {
  director: "#3b82f6",
  shareholder: "#10b981",
  beneficiary: "#f59e0b",
  trustee: "#8b5cf6",
  appointer: "#ec4899",
  settlor: "#6366f1",
  partner: "#14b8a6",
  member: "#0ea5e9",
  spouse: "#f43f5e",
  parent: "#a855f7",
  child: "#06b6d4",
};

const NODE_COLORS = [
  { label: "Individual", className: "bg-blue-100 border-blue-300 dark:bg-blue-900/40 dark:border-blue-700" },
  { label: "Company", className: "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/40 dark:border-emerald-700" },
  { label: "Trust", className: "bg-amber-100 border-amber-300 dark:bg-amber-900/40 dark:border-amber-700" },
  { label: "Partnership", className: "bg-violet-100 border-violet-300 dark:bg-violet-900/40 dark:border-violet-700" },
];

const STORAGE_KEY = "strukcha-legend-open";

interface Props {
  visible: boolean;
  onToggle: () => void;
}

export default function RelationshipLegend({ visible, onToggle }: Props) {
  const [isOpen, setIsOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === "true";
    } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(isOpen)); } catch {}
  }, [isOpen]);

  if (!visible) return null;

  return (
    <div className="absolute bottom-14 right-3 z-10 w-56">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="rounded-lg border bg-card shadow-md overflow-hidden">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full flex items-center justify-between px-3 py-2 h-auto text-xs font-semibold text-muted-foreground hover:bg-accent/50 rounded-none">
              Legend
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-3">
              {/* Node colours */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Entity Types</p>
                <div className="space-y-1">
                  {NODE_COLORS.map(({ label, className }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className={`h-3 w-5 rounded-sm border ${className}`} />
                      <span className="text-[11px]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Relationship lines */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Relationships</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(EDGE_COLORS).map(([type, color]) => (
                    <div key={type} className="flex items-center gap-1.5">
                      <div className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[11px] capitalize">{type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Indicators */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Indicators</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                    <span className="text-[11px]">Primary entity</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-3 w-3 text-violet-500" />
                    <span className="text-[11px]">Trustee company</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white">
                      <AlertCircle className="h-2 w-2" />
                    </div>
                    <span className="text-[11px]">Critical issue</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white">
                      <AlertTriangle className="h-2 w-2" />
                    </div>
                    <span className="text-[11px]">Warning</span>
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
