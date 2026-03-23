import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ChevronRight, SkipForward, Check, Download, Wrench, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPES, getEntityLabel } from "@/lib/entityTypes";
import type { ScoringIssue } from "@/lib/structureScoring";
import type { EntityNode } from "@/hooks/useStructureData";

interface Props {
  issues: ScoringIssue[];
  entities: EntityNode[];
  structureName: string;
  onClose: () => void;
  onFocusEntity: (entityId: string) => void;
  onEntityUpdated: () => void;
  onExport: () => void;
}

const FIXABLE_CODES = new Set(["unclassified", "missing_identifiers"]);

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertCircle; label: string; color: string }> = {
  critical: { icon: AlertCircle, label: "Critical", color: "text-red-600 dark:text-red-400" },
  gap: { icon: AlertTriangle, label: "Needs attention", color: "text-amber-600 dark:text-amber-400" },
  minor: { icon: Info, label: "Minor", color: "text-muted-foreground" },
  info: { icon: Info, label: "Info", color: "text-muted-foreground" },
};

function getHumanIssueTitle(issue: ScoringIssue): string {
  switch (issue.code) {
    case "unclassified": return "Missing entity type";
    case "missing_trustee": return "No trustee assigned";
    case "missing_appointer": return "No appointor recorded";
    case "missing_member": return "No members assigned";
    case "missing_directors": return "No directors recorded";
    case "missing_shareholders": return "No shareholders recorded";
    case "missing_ownership_percent": return "Ownership % not recorded";
    case "ownership_exceeds": return "Ownership exceeds 100%";
    case "orphan_entity": return "Disconnected entity";
    case "duplicate_relationship": return "Duplicate relationship";
    case "circular_ownership": return "Circular ownership";
    case "no_corporate_trustee": return "No corporate trustee";
    case "missing_identifiers": return "Missing ABN/ACN";
    default: return issue.message;
  }
}

function getHumanIssueDescription(issue: ScoringIssue): string {
  switch (issue.code) {
    case "unclassified": return `Set the entity type for "${issue.entity_name}" to improve structure clarity.`;
    case "missing_trustee": return `"${issue.entity_name}" needs a trustee. Add one from the structure diagram.`;
    case "missing_appointer": return `"${issue.entity_name}" needs an appointor. Add one from the structure diagram.`;
    case "missing_member": return `"${issue.entity_name}" needs members. Add them from the structure diagram.`;
    case "missing_directors": return `"${issue.entity_name}" needs directors. Add them from the structure diagram.`;
    case "missing_shareholders": return `"${issue.entity_name}" needs shareholders. Add them from the structure diagram.`;
    case "missing_ownership_percent": return `Record the ownership percentage for this relationship.`;
    case "ownership_exceeds": return `Total ownership for "${issue.entity_name}" exceeds 100%. Review shareholder percentages.`;
    case "orphan_entity": return `"${issue.entity_name}" has no connections. Link it or remove it from the structure.`;
    case "duplicate_relationship": return `Remove the duplicate relationship to clean up the structure.`;
    case "circular_ownership": return `Break the circular ownership chain to fix this issue.`;
    case "no_corporate_trustee": return `Add a corporate trustee to "${issue.entity_name}" for full score.`;
    case "missing_identifiers": return `Add an ABN or ACN to "${issue.entity_name}" for data completeness.`;
    default: return issue.message;
  }
}

export default function CanvasFixMode({ issues, entities, structureName, onClose, onFocusEntity, onEntityUpdated, onExport }: Props) {
  const { toast } = useToast();
  const fixableIssues = useMemo(() => issues.filter((i) => i.severity !== "info"), [issues]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolvedIds, setResolvedIds] = useState<Set<number>>(new Set());
  const [isAnimating, setIsAnimating] = useState(false);

  const totalIssues = fixableIssues.length;
  const resolvedCount = resolvedIds.size;
  const allResolved = totalIssues === 0 || resolvedCount >= totalIssues;
  const progressPercent = totalIssues > 0 ? Math.round((resolvedCount / totalIssues) * 100) : 100;

  const currentIssue = fixableIssues[currentIndex] ?? null;

  // Focus entity when issue changes
  useEffect(() => {
    if (currentIssue?.entity_id && !allResolved) {
      onFocusEntity(currentIssue.entity_id);
    }
  }, [currentIndex, currentIssue, onFocusEntity, allResolved]);

  const goToNext = useCallback(() => {
    let next = currentIndex + 1;
    // Skip resolved issues
    while (next < totalIssues && resolvedIds.has(next)) next++;
    if (next >= totalIssues) {
      // Wrap around to find unresolved
      next = 0;
      while (next < totalIssues && resolvedIds.has(next)) next++;
    }
    setCurrentIndex(next < totalIssues ? next : currentIndex);
  }, [currentIndex, totalIssues, resolvedIds]);

  const handleSkip = useCallback(() => {
    goToNext();
  }, [goToNext]);

  const handleFixUnclassified = useCallback(async (entityId: string, newType: string) => {
    setIsAnimating(true);
    const { error } = await supabase
      .from("entities")
      .update({ entity_type: newType as any })
      .eq("id", entityId);

    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      setIsAnimating(false);
      return;
    }

    toast({ title: "Entity type updated", description: `Set to ${getEntityLabel(newType)}` });
    setResolvedIds((prev) => new Set(prev).add(currentIndex));
    onEntityUpdated();

    setTimeout(() => {
      setIsAnimating(false);
      goToNext();
    }, 400);
  }, [currentIndex, toast, onEntityUpdated, goToNext]);

  const handleMarkResolved = useCallback(() => {
    setResolvedIds((prev) => new Set(prev).add(currentIndex));
    toast({ title: "Marked as resolved" });
    setTimeout(() => goToNext(), 200);
  }, [currentIndex, toast, goToNext]);

  // Completion state
  if (allResolved) {
    return (
      <div className="absolute top-3 right-3 z-20 w-80 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg overflow-hidden">
        <div className="p-5 text-center">
          {/* Animated checkmark */}
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
            <svg viewBox="0 0 52 52" className="h-8 w-8">
              <circle cx="26" cy="26" r="24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" className="animate-draw-circle" />
              <path fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M15 27l7 7 15-15" className="animate-draw-check" />
            </svg>
          </div>
          <h3 className="font-semibold text-base">All issues resolved</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {structureName} is ready to export.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>
              Done
            </Button>
            <Button size="sm" className="flex-1 gap-1.5" onClick={onExport}>
              <Download className="h-3.5 w-3.5" />
              Export Structure
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentIssue) return null;

  const sevConfig = SEVERITY_CONFIG[currentIssue.severity] ?? SEVERITY_CONFIG.minor;
  const SevIcon = sevConfig.icon;
  const isInlineFixable = FIXABLE_CODES.has(currentIssue.code);

  return (
    <div className="absolute top-3 right-3 z-20 w-80 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">Fix Mode</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
            Issue {currentIndex + 1 - resolvedCount > 0 ? currentIndex + 1 - Array.from(resolvedIds).filter(i => i < currentIndex).length : currentIndex + 1} of {totalIssues - resolvedCount}
          </Badge>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>{progressPercent}% complete</span>
          <span>{resolvedCount}/{totalIssues} resolved</span>
        </div>
        <Progress value={progressPercent} className="h-1 [&>div]:bg-primary" />
      </div>

      {/* Current Issue */}
      <div className={`px-4 py-3 transition-all duration-300 ${isAnimating ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}>
        {/* Entity name */}
        {currentIssue.entity_name && (
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {currentIssue.entity_name}
          </p>
        )}

        {/* Issue title */}
        <div className="flex items-start gap-2 mb-2">
          <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${sevConfig.color}`} />
          <div>
            <h4 className="text-sm font-medium leading-tight">{getHumanIssueTitle(currentIssue)}</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {getHumanIssueDescription(currentIssue)}
            </p>
          </div>
        </div>

        {/* Inline fix control */}
        {currentIssue.code === "unclassified" && currentIssue.entity_id && (
          <div className="mt-3">
            <Select onValueChange={(val) => handleFixUnclassified(currentIssue.entity_id!, val)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select entity type…" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.filter((t) => t !== "Unclassified").map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {getEntityLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          {!isInlineFixable && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-1" onClick={handleMarkResolved}>
              <Check className="h-3 w-3" /> Done
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 flex-1" onClick={handleSkip}>
            <SkipForward className="h-3 w-3" /> Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
