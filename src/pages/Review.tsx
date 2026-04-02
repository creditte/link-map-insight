import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Copy,
  Download,
  CircleDot,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import DuplicatesTab from "@/components/review/DuplicatesTab";
import { useClientHealthReview } from "@/hooks/useClientHealthReview";
import type { StructureIssue } from "@/hooks/useClientHealthReview";

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: typeof AlertCircle }> = {
  critical: { bg: "bg-destructive/10", text: "text-destructive", icon: AlertCircle },
  gap: { bg: "bg-warning/10", text: "text-warning", icon: AlertTriangle },
  minor: { bg: "bg-muted", text: "text-muted-foreground", icon: CircleDot },
};

export default function Review() {
  const navigate = useNavigate();
  const { review, loading, runReview } = useClientHealthReview();

  useEffect(() => {
    runReview();
  }, []);

  const issueCount = review?.allIssues.length ?? 0;
  const totalStructures = review?.structures.length ?? 0;
  const structuresWithIssues = review?.needsAttention ?? 0;
  const allResolved = !loading && review !== null && issueCount === 0;

  // Group issues by structure for display
  const issuesByStructure = new Map<string, StructureIssue[]>();
  for (const issue of review?.allIssues ?? []) {
    const arr = issuesByStructure.get(issue.structure_id) ?? [];
    arr.push(issue);
    issuesByStructure.set(issue.structure_id, arr);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      {/* ── Header ── */}
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Review &amp; Improve
        </h1>
        {loading ? (
          <Skeleton className="h-5 w-48" />
        ) : allResolved ? (
          <p className="text-base text-muted-foreground">
            All issues resolved. Your structures are ready.
          </p>
        ) : (
          <p className="text-base text-muted-foreground">
            {issueCount} issue{issueCount !== 1 ? "s" : ""} across {structuresWithIssues} structure{structuresWithIssues !== 1 ? "s" : ""}.
            Complete these to finalise your structures and enable export.
          </p>
        )}
      </section>

      {/* ── Progress ── */}
      {!loading && totalStructures > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {allResolved ? "Complete" : `${totalStructures - structuresWithIssues} of ${totalStructures} structures healthy`}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalStructures - structuresWithIssues} / {totalStructures} healthy
            </span>
          </div>
          <Progress
            value={totalStructures > 0 ? Math.round(((totalStructures - structuresWithIssues) / totalStructures) * 100) : 100}
            className="h-2 rounded-full"
          />
        </section>
      )}

      {/* ── Tabs ── */}
      <Tabs defaultValue="unresolved" className="space-y-6">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="unresolved" className="gap-1.5 rounded-lg text-xs">
            <CircleDot className="h-3.5 w-3.5" />
            Issues
            {issueCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 bg-warning/10 text-warning border-0">
                {issueCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="gap-1.5 rounded-lg text-xs">
            <Copy className="h-3.5 w-3.5" />
            Duplicates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unresolved" className="space-y-6">
          {loading ? (
            <div className="space-y-3 py-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3.5 rounded-xl border border-border/60 bg-card px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/5" />
                  </div>
                  <Skeleton className="h-9 w-[180px]" />
                </div>
              ))}
            </div>
          ) : allResolved ? (
            /* ── Completion state with celebration ── */
            <div className="relative rounded-2xl border border-success/20 bg-success/5 px-8 py-14 text-center space-y-5 overflow-hidden">
              {/* Confetti particles */}
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute block rounded-full animate-confetti"
                    style={{
                      width: `${4 + Math.random() * 6}px`,
                      height: `${4 + Math.random() * 6}px`,
                      left: `${10 + Math.random() * 80}%`,
                      top: "-8px",
                      backgroundColor: [
                        "hsl(var(--success))",
                        "hsl(var(--primary))",
                        "hsl(var(--warning))",
                        "hsl(152 56% 70%)",
                        "hsl(220 65% 70%)",
                        "hsl(38 92% 65%)",
                      ][i % 6],
                      animationDelay: `${Math.random() * 0.6}s`,
                      animationDuration: `${1.2 + Math.random() * 0.8}s`,
                    }}
                  />
                ))}
              </div>

              {/* Animated checkmark */}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10 animate-scale-in">
                <svg
                  className="h-9 w-9 text-success"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle
                    cx="12" cy="12" r="10"
                    className="animate-draw-circle"
                    style={{ strokeDasharray: 63, strokeDashoffset: 63 }}
                  />
                  <path
                    d="M8 12l3 3 5-5"
                    className="animate-draw-check"
                    style={{ strokeDasharray: 14, strokeDashoffset: 14 }}
                  />
                </svg>
              </div>

              <div className="space-y-1.5 animate-fade-in-up" style={{ animationDelay: "0.5s", animationFillMode: "both" }}>
                <h3 className="text-xl font-semibold text-foreground">
                  All issues resolved
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Your structures are complete and ready to export.
                </p>
              </div>
              <Button
                size="lg"
                className="gap-2 rounded-xl px-6 text-sm font-medium animate-fade-in-up"
                style={{ animationDelay: "0.7s", animationFillMode: "both" }}
                onClick={() => navigate("/structures")}
              >
                <Download className="h-4 w-4" />
                Export Structures
              </Button>
            </div>
          ) : (
            /* ── Issue list grouped by structure ── */
            <div className="space-y-6">
              {Array.from(issuesByStructure.entries()).map(([structureId, issues]) => {
                const structureName = issues[0]?.structure_name ?? "Unknown";
                const criticalCount = issues.filter((i) => i.severity === "critical").length;
                return (
                  <div key={structureId} className="space-y-2">
                    {/* Structure header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{structureName}</h3>
                        {criticalCount > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-destructive/10 text-destructive border-0">
                            {criticalCount} critical
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs text-muted-foreground h-7"
                        onClick={() => navigate(`/structures/${structureId}`)}
                      >
                        Open
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Issues for this structure */}
                    {issues.map((issue, idx) => {
                      const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.minor;
                      const Icon = style.icon;
                      return (
                        <div
                          key={`${issue.code}-${issue.entity_id ?? idx}`}
                          className="flex items-center gap-3.5 rounded-xl border border-border/60 bg-card px-5 py-4 transition-all hover:border-border"
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.bg}`}>
                            <Icon className={`h-4 w-4 ${style.text}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {issue.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                              {issue.category} · {issue.severity === "gap" ? "Warning" : issue.severity}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Blocker message ── */}
          {!loading && issueCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl bg-muted/50 border border-border/60 px-5 py-3.5">
              <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Export unavailable</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete all items above to export your structures.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="duplicates" className="space-y-6">
          <DuplicatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
