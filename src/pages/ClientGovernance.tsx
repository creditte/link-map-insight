import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Info,
  Loader2,
} from "lucide-react";
import { computeHealthScoreV2, getHealthStatus } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";

/* ── Friendly labels ────────────────────────────────────────────── */

function getFriendlyLabel(score: number): string {
  if (score >= 100) return "Good";
  if (score >= 70) return "Minor gaps";
  if (score >= 50) return "Needs attention";
  return "Critical";
}

function getScoreMessage(score: number, count: number): string {
  if (count === 0) return "No structures to review yet.";
  if (score >= 90) return "Your structures are in good shape.";
  if (score >= 50) return "Some improvements needed across your structures.";
  return "Your structures need attention.";
}

const STATUS_DOT: Record<string, string> = {
  good: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const STATUS_BG: Record<string, string> = {
  good: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  critical: "bg-destructive/10 text-destructive",
};

/* ── Types ──────────────────────────────────────────────────────── */

interface StructureResult {
  id: string;
  name: string;
  score: number;
  status: "good" | "warning" | "critical";
  friendlyLabel: string;
  issues: string[];
  criticalCount: number;
}

interface ClientReview {
  timestamp: string;
  clientScore: number;
  structures: StructureResult[];
  crossObservations: string[];
  criticalStructures: number;
  needsAttention: number;
}

/* ── Page ───────────────────────────────────────────────────────── */

export default function ClientGovernance() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [review, setReview] = useState<ClientReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [structuresChanged, setStructuresChanged] = useState(false);

  useEffect(() => {
    if (!review) return;
    async function checkChanges() {
      const { data } = await supabase
        .from("structures")
        .select("updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (data?.[0]) {
        setStructuresChanged(new Date(data[0].updated_at) > new Date(review!.timestamp));
      }
    }
    checkChanges();
  }, [review]);

  const runReview = useCallback(async () => {
    setLoading(true);
    try {
      const { data: structures } = await supabase
        .from("structures")
        .select("id, name")
        .is("deleted_at", null)
        .eq("is_scenario", false);

      if (!structures || structures.length === 0) {
        toast({ title: "No structures", description: "No active structures to review." });
        setLoading(false);
        return;
      }

      const structureIds = structures.map((s) => s.id);

      const [seResult, srResult] = await Promise.all([
        supabase.from("structure_entities").select("structure_id, entity_id").in("structure_id", structureIds),
        supabase.from("structure_relationships").select("structure_id, relationship_id").in("structure_id", structureIds),
      ]);

      const seByStruct = new Map<string, string[]>();
      for (const row of seResult.data ?? []) {
        const arr = seByStruct.get(row.structure_id) ?? [];
        arr.push(row.entity_id);
        seByStruct.set(row.structure_id, arr);
      }

      const srByStruct = new Map<string, string[]>();
      for (const row of srResult.data ?? []) {
        const arr = srByStruct.get(row.structure_id) ?? [];
        arr.push(row.relationship_id);
        srByStruct.set(row.structure_id, arr);
      }

      const allEntityIds = new Set<string>();
      const allRelIds = new Set<string>();
      for (const ids of seByStruct.values()) ids.forEach((id) => allEntityIds.add(id));
      for (const ids of srByStruct.values()) ids.forEach((id) => allRelIds.add(id));

      const [entResult, relResult] = await Promise.all([
        allEntityIds.size > 0
          ? supabase.from("entities")
              .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, is_trustee_company, created_at")
              .in("id", Array.from(allEntityIds))
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),
        allRelIds.size > 0
          ? supabase.from("relationships")
              .select("id, from_entity_id, to_entity_id, relationship_type, source, ownership_percent, ownership_units, ownership_class, created_at")
              .in("id", Array.from(allRelIds))
              .is("deleted_at", null)
          : Promise.resolve({ data: [] }),
      ]);

      const entityById = new Map<string, EntityNode>();
      for (const e of (entResult.data ?? []) as any[]) entityById.set(e.id, e as EntityNode);

      const relById = new Map<string, RelationshipEdge>();
      for (const r of (relResult.data ?? []) as any[]) {
        relById.set(r.id, {
          id: r.id, from_entity_id: r.from_entity_id, to_entity_id: r.to_entity_id,
          relationship_type: r.relationship_type, source_data: r.source,
          ownership_percent: r.ownership_percent, ownership_units: r.ownership_units,
          ownership_class: r.ownership_class, created_at: r.created_at,
        });
      }

      const results: StructureResult[] = [];
      let trustsWithoutCorporateTrustee = 0;
      let missingAppointerCount = 0;
      let circularCount = 0;

      for (const s of structures) {
        const entIds = seByStruct.get(s.id) ?? [];
        const relIds = srByStruct.get(s.id) ?? [];
        const ents = entIds.map((id) => entityById.get(id)).filter(Boolean) as EntityNode[];
        const rels = relIds.map((id) => relById.get(id)).filter(Boolean) as RelationshipEdge[];
        const health = computeHealthScoreV2(ents, rels);

        results.push({
          id: s.id,
          name: s.name,
          score: health.score,
          status: getHealthStatus(health.score),
          friendlyLabel: getFriendlyLabel(health.score),
          issues: health.issues.map((i) => i.message),
          criticalCount: health.criticalGaps.length,
        });

        if (health.isCapped) trustsWithoutCorporateTrustee++;
        missingAppointerCount += health.issues.filter((i) => i.code === "missing_appointer").length;
        if (health.issues.some((i) => i.code === "circular_ownership")) circularCount++;
      }

      const crossObservations: string[] = [];
      if (trustsWithoutCorporateTrustee > 0)
        crossObservations.push(`${trustsWithoutCorporateTrustee} structure${trustsWithoutCorporateTrustee > 1 ? "s have" : " has"} trusts without corporate trustees`);
      if (missingAppointerCount > 0)
        crossObservations.push(`${missingAppointerCount} trust${missingAppointerCount > 1 ? "s" : ""} missing appointers across structures`);
      if (circularCount > 0)
        crossObservations.push(`${circularCount} structure${circularCount > 1 ? "s" : ""} with circular ownership detected`);

      const avgScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        : 100;
      const allPerfect = results.every((r) => r.score >= 100);
      const finalClientScore = allPerfect ? avgScore : Math.min(avgScore, 99);

      const criticalStructures = results.filter((r) => r.status === "critical").length;
      const needsAttention = results.filter((r) => r.score < 100).length;

      setReview({
        timestamp: new Date().toISOString(),
        clientScore: finalClientScore,
        structures: results.sort((a, b) => a.score - b.score),
        crossObservations,
        criticalStructures,
        needsAttention,
      });

      setStructuresChanged(false);
      toast({ title: "Health check complete" });
    } catch (e) {
      console.error("Review error:", e);
      toast({ title: "Review failed", variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-14">
      {/* ── Hero / Empty State ── */}
      {!review && !loading && (
        <section className="text-center py-12 space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10">
            <HeartPulse className="h-8 w-8 text-success" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Structure Health
            </h1>
            <p className="text-base text-muted-foreground max-w-md mx-auto">
              Run a health check to assess the quality and completeness of all your client structures.
            </p>
          </div>
          <Button
            size="lg"
            className="gap-2 rounded-xl px-6 text-sm font-medium"
            onClick={runReview}
          >
            <HeartPulse className="h-4 w-4" />
            Run Health Check
          </Button>
        </section>
      )}

      {loading && (
        <section className="text-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Analysing structures…</p>
        </section>
      )}

      {review && (
        <>
          {/* ── Score Hero ── */}
          <section className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Structure Health
                </h1>
                <p className="text-base text-muted-foreground">
                  {getScoreMessage(review.clientScore, review.structures.length)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl text-xs shrink-0"
                onClick={runReview}
                disabled={loading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-run
              </Button>
            </div>

            {/* Score + stats row */}
            <div className="flex items-center gap-8">
              {/* Score circle */}
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
                <svg className="absolute inset-0 h-24 w-24 -rotate-90" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
                  <circle
                    cx="48" cy="48" r="42" fill="none"
                    stroke={review.clientScore >= 90 ? "hsl(var(--success))" : review.clientScore >= 50 ? "hsl(var(--warning))" : "hsl(var(--destructive))"}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${(review.clientScore / 100) * 264} 264`}
                  />
                </svg>
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {review.clientScore}
                </span>
              </div>

              {/* Stats */}
              <div className="flex gap-10">
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-foreground">{review.structures.length}</p>
                  <p className="text-xs text-muted-foreground">Structures reviewed</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-foreground">{review.needsAttention}</p>
                  <p className="text-xs text-muted-foreground">Requiring updates</p>
                </div>
              </div>
            </div>

            {structuresChanged && (
              <div className="flex items-center gap-2 rounded-xl bg-warning/10 border border-warning/20 px-4 py-2.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Structures have changed since last review — consider re-running.
              </div>
            )}

            {/* CTAs */}
            {review.needsAttention > 0 && (
              <div className="flex items-center gap-3">
                <Button
                  className="gap-2 rounded-xl px-5 text-sm font-medium"
                  onClick={() => navigate("/review")}
                >
                  Review Issues
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </section>

          {/* ── Priority Issues ── */}
          {(review.criticalStructures > 0 || review.needsAttention > 0) && (
            <section className="space-y-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Priority Issues
              </h2>
              <div className="space-y-2">
                {review.criticalStructures > 0 && (
                  <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-3.5">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <span className="text-sm text-foreground">
                      <span className="font-semibold">{review.criticalStructures} structure{review.criticalStructures > 1 ? "s" : ""}</span>{" "}
                      with critical issues
                    </span>
                  </div>
                )}
                {review.needsAttention > review.criticalStructures && (
                  <div className="flex items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 px-5 py-3.5">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                    <span className="text-sm text-foreground">
                      <span className="font-semibold">{review.needsAttention - review.criticalStructures} structure{(review.needsAttention - review.criticalStructures) > 1 ? "s" : ""}</span>{" "}
                      need improvements
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Structures List ── */}
          <section className="space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              All Structures
            </h2>
            <div className="space-y-1.5">
              {review.structures.map((s) => (
                <Link
                  key={s.id}
                  to={`/structures/${s.id}`}
                  className="group flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4 transition-all hover:border-border hover:shadow-sm"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[s.status]}`} />
                    <span className="text-sm font-medium text-foreground">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold tabular-nums text-foreground">{s.score}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[11px] rounded-md border-0 font-medium ${STATUS_BG[s.status]}`}
                    >
                      {s.friendlyLabel}
                    </Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ── Key Insights ── */}
          {review.crossObservations.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Key Insights
              </h2>
              <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
                {review.crossObservations.map((obs, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <Info className="h-4 w-4 shrink-0 text-primary/60 mt-0.5" />
                    <span>{obs}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground/50 text-center">
            Last reviewed {new Date(review.timestamp).toLocaleString("en-AU", {
              day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </>
      )}
    </div>
  );
}
