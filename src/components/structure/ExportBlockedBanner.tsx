import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityNode } from "@/hooks/useStructureData";

interface Props {
  entities: EntityNode[];
}

export default function ExportBlockedBanner({ entities }: Props) {
  const unclassified = entities.filter(
    (e) => e.entity_type === "Unclassified"
  );

  if (unclassified.length === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <span className="text-muted-foreground">
        {unclassified.length} unclassified {unclassified.length === 1 ? "entity" : "entities"} may affect export quality.
      </span>
      <Button variant="outline" size="sm" className="ml-auto h-7 text-xs gap-1" asChild>
        <Link to="/review">Fix now → Review &amp; Fix</Link>
      </Button>
    </div>
  );
}
