import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { HeartPulse, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { computeHealthScoreV2Light, getHealthLabel, getHealthStatus } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { computeHealthScoreV2 } from "@/lib/structureScoring";

interface StructureResult {
  id: string;
  name: string;
  score: number;
  displayScore: number;
  label: string;
  status: "good" | "warning" | "critical";
  issues: string[];
}

interface ClientReview {
  timestamp: string;
  clientScore: number;
  clientDisplayScore: number;
  clientLabel: string;
  structures: StructureResult[];
  crossObservations: string[];
}

const STATUS_COLORS: Record<string, string> = {
  good: "bg-emerald-500/10 text-emerald-700",
  warning: "bg-amber-500/10 text-amber-700",
  critical: "bg-red-500/10 text-red-700",
};

export default function ClientGovernance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [review, setReview] = useState<ClientReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [structuresChanged, setStructuresChanged] = useState(false);

  // Check if structures have changed since last review
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
        const lastUpdated = new Date(data[0].updated_at);
        const reviewTime = new Date(review!.timestamp);
        setStructuresChanged(lastUpdated > reviewTime);
      }
    }
    checkChanges();
  }, [review]);

  const runReview = useCallback(async () => {
    setLoading(true);

    try {
      // 1. Fetch all active structures
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

      // 2. Fetch all entities and relationships
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
      for (const e of (entResult.data ?? []) as any[]) {
        entityById.set(e.id, e as EntityNode);
      }

      const relById = new Map<string, RelationshipEdge>();
      for (const r of (relResult.data ?? []) as any[]) {
        relById.set(r.id, {
          id: r.id,
          from_entity_id: r.from_entity_id,
          to_entity_id: r.to_entity_id,
          relationship_type: r.relationship_type,
          source_data: r.source,
          ownership_percent: r.ownership_percent,
          ownership_units: r.ownership_units,
          ownership_class: r.ownership_class,
          created_at: r.created_at,
        });
      }

      // 3. Compute health for each structure
      const results: StructureResult[] = [];
      const allIssues: string[] = [];
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
          displayScore: health.displayScore,
          label: health.label,
          status: getHealthStatus(health.displayScore),
          issues: health.issues.map((i) => i.message),
        });

        // Cross-structure aggregation
        if (health.isCapped) trustsWithoutCorporateTrustee++;
        missingAppointerCount += health.issues.filter((i) => i.code === "missing_appointer").length;
        if (health.issues.some((i) => i.code === "circular_ownership")) circularCount++;
      }

      // 4. Cross-structure observations
      const crossObservations: string[] = [];
      if (trustsWithoutCorporateTrustee > 0) {
        crossObservations.push(`${trustsWithoutCorporateTrustee} structure${trustsWithoutCorporateTrustee > 1 ? "s have" : " has"} trusts without corporate trustees recorded`);
      }
      if (missingAppointerCount > 0) {
        crossObservations.push(`${missingAppointerCount} trust${missingAppointerCount > 1 ? "s" : ""} missing appointer across structures`);
      }
      if (circularCount > 0) {
        crossObservations.push(`${circularCount} structure${circularCount > 1 ? "s" : ""} with circular ownership detected`);
      } else {
        crossObservations.push("No circular ownership detected");
      }

      const requireUpdates = results.filter((r) => r.score < 100);
      if (requireUpdates.length > 0) {
        crossObservations.push(`${requireUpdates.length} structure${requireUpdates.length > 1 ? "s" : ""} require${requireUpdates.length === 1 ? "s" : ""} updates`);
      }

      // 5. Client-level score = average of all structure scores
      const avgScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        : 100;

      // Client 100/100 requires all structures at 100
      const allPerfect = results.every((r) => r.score >= 100);
      const finalClientScore = allPerfect ? avgScore : Math.min(avgScore, 99);

      setReview({
        timestamp: new Date().toISOString(),
        clientScore: finalClientScore,
        clientDisplayScore: finalClientScore,
        clientLabel: getHealthLabel(finalClientScore),
        structures: results,
        crossObservations,
      });

      setStructuresChanged(false);
      toast({ title: "Client review complete" });
    } catch (e) {
      console.error("Client review error:", e);
      toast({ title: "Review failed", variant: "destructive" });
    }

    setLoading(false);
  }, [toast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Governance Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review all structures for governance completeness
          </p>
        </div>
        <Button onClick={runReview} disabled={loading} className="gap-2">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HeartPulse className="h-4 w-4" />}
          {loading ? "Reviewing..." : "Run Client Governance Review"}
        </Button>
      </div>

      {review && (
        <>
          {structuresChanged && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Client review out of date — structures have changed since last review.
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <HeartPulse className="h-5 w-5" />
                  Client Governance Health: {review.clientDisplayScore} / 100
                  <Badge className={`text-xs ${STATUS_COLORS[getHealthStatus(review.clientDisplayScore)]}`}>
                    {review.clientLabel}
                  </Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  Last Reviewed: {new Date(review.timestamp).toLocaleString("en-AU", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {review.structures.length} structures reviewed. {review.structures.filter((s) => s.score < 100).length} require updates.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Structure table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Structure</TableHead>
                    <TableHead className="w-24 text-right">Score</TableHead>
                    <TableHead className="w-36">Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {review.structures.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{s.score}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${STATUS_COLORS[s.status]}`}>
                          {s.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator />

              {/* Cross-structure observations */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Cross-Structure Observations</h4>
                <ul className="space-y-1.5">
                  {review.crossObservations.map((obs, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                      {obs.includes("No circular") || obs.includes("None") ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
                      )}
                      {obs}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!review && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <HeartPulse className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              Click "Run Client Governance Review" to analyse all structures.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              The review will compute health scores for every active structure.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
