import { useEffect, useState, useCallback } from "react";
import { formatAbn, formatAcn } from "@/components/structure/EntityInfoFields";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle, Merge, Loader2, AlertTriangle, Shield, Building2, Undo2, X } from "lucide-react";
import { getEntityLabel } from "@/lib/entityTypes";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DuplicateEntity {
  id: string;
  name: string;
  type: string;
  abn?: string | null;
  acn?: string | null;
  xpm_uuid?: string | null;
  is_trustee_company?: boolean;
  is_operating_entity?: boolean;
  inbound_count?: number;
  outbound_count?: number;
  updated_at?: string;
  created_at?: string;
}

type ConfidenceLevel = "exact" | "high" | "medium";

interface DuplicateGroup {
  normalizedName: string;
  similarity: number;
  confidence: ConfidenceLevel;
  entities: DuplicateEntity[];
}

interface MergePreview {
  relationships_to_repoint: number;
  potential_collisions: number;
  entities_to_delete: number;
}

function computeConfidence(entities: DuplicateEntity[], similarity: number): ConfidenceLevel {
  // Check for exact identifier matches across any pair
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      if ((a.abn && b.abn && a.abn === b.abn) ||
          (a.acn && b.acn && a.acn === b.acn) ||
          (a.xpm_uuid && b.xpm_uuid && a.xpm_uuid === b.xpm_uuid)) {
        return "exact";
      }
    }
  }
  if (similarity >= 90) return "high";
  return "medium";
}

function pickSmartPrimary(entities: DuplicateEntity[]): string {
  const scored = entities.map((e) => {
    let score = 0;
    if (e.abn || e.acn) score += 1000;
    if (e.xpm_uuid) score += 500;
    score += (e.inbound_count ?? 0) + (e.outbound_count ?? 0);
    // Tiny tiebreaker: most recently updated
    const ts = e.updated_at || e.created_at || "";
    score += ts ? new Date(ts).getTime() / 1e15 : 0;
    return { id: e.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

const CONFIDENCE_CONFIG: Record<ConfidenceLevel, { label: string; variant: "default" | "secondary" | "outline"; helper: string }> = {
  exact: { label: "Exact match", variant: "default", helper: "Identifiers (ABN/ACN/XPM) match — very likely the same entity." },
  high: { label: "High similarity", variant: "secondary", helper: "Names are ≥90% similar. Review before merging." },
  medium: { label: "Medium similarity", variant: "outline", helper: "Names are 85–89% similar. Check carefully." },
};

const DISMISSED_KEY = "dismissed-duplicate-groups";

function getDismissedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function buildGroupKey(entities: DuplicateEntity[]): string {
  return entities.map(e => e.id).sort().join("|");
}

export default function DuplicatesTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(getDismissedGroups);
  const [loading, setLoading] = useState(true);

  // Merge dialog state
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id ?? "")
      .single();

    if (!profile) {
      setLoading(false);
      return;
    }

    // Try fuzzy matching first, fall back to exact matching
    const { data: fuzzyData, error: fuzzyError } = await supabase.rpc(
      "find_fuzzy_duplicate_entities" as any,
      { _tenant_id: profile.tenant_id, _threshold: 0.85 }
    );

    let rows: any[] = [];
    if (fuzzyError) {
      console.warn("Fuzzy matching unavailable, falling back to exact:", fuzzyError.message);
      const { data: exactData, error: exactError } = await supabase.rpc("find_duplicate_entities", {
        _tenant_id: profile.tenant_id,
      });
      if (exactError) {
        toast({ title: "Failed to find duplicates", description: exactError.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      rows = (exactData ?? []).map((r: any) => ({ ...r, similarity: 1.0 }));
    } else {
      rows = fuzzyData ?? [];
    }

    // Collect all entity IDs for enrichment
    const allEntityIds = new Set<string>();
    for (const row of rows) {
      allEntityIds.add(row.entity_id_a);
      allEntityIds.add(row.entity_id_b);
    }

    // Fetch full entity details
    let entityDetails = new Map<string, any>();
    if (allEntityIds.size > 0) {
      const { data: entities } = await supabase
        .from("entities")
      .select("id, name, entity_type, abn, acn, xpm_uuid, is_trustee_company, is_operating_entity, updated_at, created_at")
      .in("id", Array.from(allEntityIds))
      .is("deleted_at", null);

      for (const e of entities ?? []) {
        entityDetails.set(e.id, e);
      }

      // Fetch relationship counts
      const { data: rels } = await supabase
        .from("relationships")
        .select("id, from_entity_id, to_entity_id")
        .is("deleted_at", null)
        .or(
          Array.from(allEntityIds).map((id) => `from_entity_id.eq.${id}`).join(",") +
          "," +
          Array.from(allEntityIds).map((id) => `to_entity_id.eq.${id}`).join(",")
        );

      const outboundCounts = new Map<string, number>();
      const inboundCounts = new Map<string, number>();
      for (const r of rels ?? []) {
        outboundCounts.set(r.from_entity_id, (outboundCounts.get(r.from_entity_id) ?? 0) + 1);
        inboundCounts.set(r.to_entity_id, (inboundCounts.get(r.to_entity_id) ?? 0) + 1);
      }

      for (const [id, e] of entityDetails) {
        e.outbound_count = outboundCounts.get(id) ?? 0;
        e.inbound_count = inboundCounts.get(id) ?? 0;
      }
    }

    // Group pairs into clusters using union-find
    const parent = new Map<string, string>();
    function find(x: string): string {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    }
    function union(a: string, b: string) {
      const pa = find(a), pb = find(b);
      if (pa !== pb) parent.set(pa, pb);
    }

    const pairSimilarity = new Map<string, number>();
    for (const row of rows) {
      // Only cluster same type
      const eA = entityDetails.get(row.entity_id_a);
      const eB = entityDetails.get(row.entity_id_b);
      if (!eA || !eB) continue;
      if (eA.entity_type !== eB.entity_type) continue;

      union(row.entity_id_a, row.entity_id_b);
      const key = [row.entity_id_a, row.entity_id_b].sort().join("|");
      pairSimilarity.set(key, Math.max(pairSimilarity.get(key) ?? 0, row.similarity ?? 1.0));
    }

    // Build clusters
    const clusterMap = new Map<string, { entityIds: Set<string>; maxSimilarity: number }>();
    for (const row of rows) {
      const eA = entityDetails.get(row.entity_id_a);
      const eB = entityDetails.get(row.entity_id_b);
      if (!eA || !eB || eA.entity_type !== eB.entity_type) continue;

      const root = find(row.entity_id_a);
      if (!clusterMap.has(root)) {
        clusterMap.set(root, { entityIds: new Set(), maxSimilarity: 0 });
      }
      const cluster = clusterMap.get(root)!;
      cluster.entityIds.add(row.entity_id_a);
      cluster.entityIds.add(row.entity_id_b);
      cluster.maxSimilarity = Math.max(cluster.maxSimilarity, row.similarity ?? 1.0);
    }

    const result: DuplicateGroup[] = [];
    for (const [, cluster] of clusterMap) {
      const ents: DuplicateEntity[] = Array.from(cluster.entityIds)
        .map((id) => {
          const e = entityDetails.get(id);
          if (!e) return null;
          return {
            id: e.id,
            name: e.name,
            type: e.entity_type,
            abn: e.abn,
            acn: e.acn,
            xpm_uuid: e.xpm_uuid,
            is_trustee_company: e.is_trustee_company,
            is_operating_entity: e.is_operating_entity,
            inbound_count: e.inbound_count ?? 0,
            outbound_count: e.outbound_count ?? 0,
            updated_at: e.updated_at,
            created_at: e.created_at,
          };
        })
        .filter(Boolean) as DuplicateEntity[];

      if (ents.length < 2) continue;

      const sim = Math.round(cluster.maxSimilarity * 100);
      result.push({
        normalizedName: ents[0].name,
        similarity: sim,
        confidence: computeConfidence(ents, sim),
        entities: ents,
      });
    }

    result.sort((a, b) => b.similarity - a.similarity);
    setGroups(result);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => {
    if (user?.id) loadDuplicates();
  }, [user?.id, loadDuplicates]);

  const dismissGroup = (group: DuplicateGroup) => {
    const key = buildGroupKey(group.entities);
    const next = new Set(dismissedKeys);
    next.add(key);
    setDismissedKeys(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    toast({ title: "Dismissed", description: `"${group.normalizedName}" marked as not a duplicate.` });
  };

  const restoreDismissed = () => {
    setDismissedKeys(new Set());
    localStorage.removeItem(DISMISSED_KEY);
    toast({ title: "Restored", description: "All dismissed groups are visible again." });
  };

  const visibleGroups = groups.filter(g => !dismissedKeys.has(buildGroupKey(g.entities)));
  const dismissedCount = groups.length - visibleGroups.length;

  const openMergeDialog = (group: DuplicateGroup) => {
    const types = new Set(group.entities.map((e) => e.type));
    if (types.size > 1) {
      toast({
        title: "Cannot merge",
        description: "Entities must be the same type to merge.",
        variant: "destructive",
      });
      return;
    }
    setMergeGroup(group);
    setPrimaryId(pickSmartPrimary(group.entities));
    setMergePreview(null);
  };

  // Compute preview impact when primary changes
  const loadPreview = useCallback(async () => {
    if (!mergeGroup || !primaryId) return;
    setLoadingPreview(true);

    const duplicateIds = mergeGroup.entities.filter((e) => e.id !== primaryId).map((e) => e.id);
    if (duplicateIds.length === 0) {
      setMergePreview({ relationships_to_repoint: 0, potential_collisions: 0, entities_to_delete: 0 });
      setLoadingPreview(false);
      return;
    }

    // Fetch relationships for duplicates
    const { data: dupRels } = await supabase
      .from("relationships")
      .select("id, from_entity_id, to_entity_id, relationship_type")
      .is("deleted_at", null)
      .or(
        duplicateIds.map((id) => `from_entity_id.eq.${id}`).join(",") +
        "," +
        duplicateIds.map((id) => `to_entity_id.eq.${id}`).join(",")
      );

    // Fetch relationships for primary
    const { data: primaryRels } = await supabase
      .from("relationships")
      .select("id, from_entity_id, to_entity_id, relationship_type")
      .is("deleted_at", null)
      .or(`from_entity_id.eq.${primaryId},to_entity_id.eq.${primaryId}`);

    const primaryKeys = new Set(
      (primaryRels ?? []).map(
        (r) => `${r.from_entity_id}|${r.to_entity_id}|${r.relationship_type}`
      )
    );

    let collisions = 0;
    let repoints = 0;
    const dupIdSet = new Set(duplicateIds);

    for (const rel of dupRels ?? []) {
      const newFrom = dupIdSet.has(rel.from_entity_id) ? primaryId : rel.from_entity_id;
      const newTo = dupIdSet.has(rel.to_entity_id) ? primaryId : rel.to_entity_id;

      if (newFrom === newTo) {
        collisions++;
        continue;
      }

      const key = `${newFrom}|${newTo}|${rel.relationship_type}`;
      if (primaryKeys.has(key)) {
        collisions++;
      } else {
        repoints++;
        primaryKeys.add(key);
      }
    }

    setMergePreview({ relationships_to_repoint: repoints, potential_collisions: collisions, entities_to_delete: duplicateIds.length });
    setLoadingPreview(false);
  }, [mergeGroup, primaryId]);

  useEffect(() => {
    if (mergeGroup) loadPreview();
  }, [primaryId, mergeGroup, loadPreview]);

  const handleMerge = async () => {
    if (!mergeGroup || !primaryId) return;
    setMerging(true);

    const duplicateIds = mergeGroup.entities.filter((e) => e.id !== primaryId).map((e) => e.id);

    try {
      const { data, error } = await supabase.functions.invoke("merge-entities", {
        body: {
          primary_entity_id: primaryId,
          merged_entity_ids: duplicateIds,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const primaryName = mergeGroup.entities.find((e) => e.id === primaryId)?.name ?? "entity";
      toast({
        title: `Merged ${duplicateIds.length} ${duplicateIds.length === 1 ? "entity" : "entities"} into "${primaryName}"`,
        description: `${data.relationships_repointed} re-pointed, ${data.relationships_deduped} deduplicated.`,
        action: (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" disabled className="gap-1 opacity-50">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo is coming soon. Merges are currently final.</TooltipContent>
          </Tooltip>
        ),
      });
      setMergeGroup(null);
      loadDuplicates();
    } catch (err: any) {
      console.error("Merge failed:", err);
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    }

    setMerging(false);
  };

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (visibleGroups.length === 0 && groups.length === 0) {
    return (
      <Card className="max-w-lg">
        <CardContent className="flex items-center gap-3 p-6">
          <CheckCircle className="h-6 w-6 text-primary" />
          <div>
            <p className="font-medium">No duplicates found</p>
            <p className="text-sm text-muted-foreground">
              All entity names are unique after normalization and fuzzy matching.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {visibleGroups.length} potential duplicate {visibleGroups.length === 1 ? "group" : "groups"} detected.
              Review and merge to keep your data clean.
            </p>
            {dismissedCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 shrink-0" onClick={restoreDismissed}>
                <Undo2 className="h-3 w-3" />
                Show {dismissedCount} dismissed
              </Button>
            )}
          </div>

          {visibleGroups.length === 0 && dismissedCount > 0 && (
            <Card className="max-w-lg">
              <CardContent className="flex items-center gap-3 p-6">
                <CheckCircle className="h-6 w-6 text-primary" />
                <div>
                  <p className="font-medium">All groups dismissed</p>
                  <p className="text-sm text-muted-foreground">
                    You've dismissed all {dismissedCount} duplicate {dismissedCount === 1 ? "group" : "groups"}. Click "Show dismissed" to review again.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {visibleGroups.map((group, idx) => {
            const types = new Set(group.entities.map((e) => e.type));
            const crossType = types.size > 1;
            const conf = CONFIDENCE_CONFIG[group.confidence];

            return (
              <Card key={idx}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {group.entities.length} likely duplicates
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant={conf.variant} className="text-[10px] px-1.5 py-0 cursor-help">
                            {conf.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          {conf.helper}
                        </TooltipContent>
                      </Tooltip>
                      {crossType && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Mixed types
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-muted-foreground"
                            onClick={() => dismissGroup(group)}
                          >
                            <X className="h-3.5 w-3.5" /> Not a duplicate
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Dismiss this group as a false positive</TooltipContent>
                      </Tooltip>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => openMergeDialog(group)}
                        disabled={crossType}
                      >
                        <Merge className="h-3.5 w-3.5" /> Merge
                      </Button>
                    </div>
                  </div>

                  {/* Comparison table */}
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">ABN</TableHead>
                          <TableHead className="text-xs">ACN</TableHead>
                          <TableHead className="text-xs text-center">Trustee Co</TableHead>
                          <TableHead className="text-xs text-center">Operating</TableHead>
                          <TableHead className="text-xs text-right">Rels (in/out)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.entities.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs font-medium py-2">{e.name}</TableCell>
                            <TableCell className="text-xs py-2">
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {getEntityLabel(e.type)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs py-2 font-mono">{e.abn ? formatAbn(e.abn) : "—"}</TableCell>
                            <TableCell className="text-xs py-2 font-mono">{e.acn ? formatAcn(e.acn) : "—"}</TableCell>
                            <TableCell className="text-xs py-2 text-center">
                              {e.is_trustee_company ? <Shield className="h-3.5 w-3.5 text-primary mx-auto" /> : "—"}
                            </TableCell>
                            <TableCell className="text-xs py-2 text-center">
                              {e.is_operating_entity ? <Building2 className="h-3.5 w-3.5 text-primary mx-auto" /> : "—"}
                            </TableCell>
                            <TableCell className="text-xs py-2 text-right">
                              {e.inbound_count ?? 0} / {e.outbound_count ?? 0}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

      {/* Merge Dialog */}
      <Dialog open={!!mergeGroup} onOpenChange={(open) => !open && setMergeGroup(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge Entities</DialogTitle>
            <DialogDescription>
              Choose the primary entity to keep. All relationships from merged entities will be
              reassigned to the primary. Merged entities will be soft-deleted and hidden.
            </DialogDescription>
          </DialogHeader>

          {mergeGroup && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Select Primary Entity (keep)
                </Label>
                <RadioGroup value={primaryId} onValueChange={setPrimaryId}>
                  {mergeGroup.entities.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-md border p-3">
                      <RadioGroupItem value={e.id} id={`primary-${e.id}`} />
                      <Label htmlFor={`primary-${e.id}`} className="flex-1 cursor-pointer">
                        <span className="text-sm font-medium">{e.name}</span>
                        {e.abn && (
                          <span className="text-[10px] text-muted-foreground ml-2 font-mono">
                            ABN: {e.abn}
                          </span>
                        )}
                      </Label>
                      {e.id === primaryId ? (
                        <Badge className="text-[10px] px-1.5 py-0">Keep</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Merge</Badge>
                      )}
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Impact preview */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Impact Preview
                </Label>
                {loadingPreview ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating...
                  </div>
                ) : mergePreview ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Re-point:</span>{" "}
                        <span className="font-semibold">{mergePreview.relationships_to_repoint}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Dedupe:</span>{" "}
                        <span className="font-semibold">{mergePreview.potential_collisions}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Soft-delete:</span>{" "}
                        <span className="font-semibold">{mergePreview.entities_to_delete}</span>
                      </div>
                    </div>
                    {mergePreview.potential_collisions > 0 && (
                      <p className="text-[10px] text-muted-foreground italic">
                        Collisions will be deduplicated; ownership fields will be preserved (primary wins unless null).
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Warning box */}
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">This action cannot be easily undone.</p>
                  <p>All relationships from merged entities will be reassigned to the primary entity.</p>
                  <p>Merged entities will be soft-deleted and hidden by default.</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeGroup(null)} disabled={merging}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={merging || !primaryId} variant="destructive">
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" /> Merging...
                </>
              ) : (
                `Merge ${(mergeGroup?.entities.length ?? 1) - 1} into primary`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo merge placeholder toast CTA — rendered as a disabled button in footer area */}
      </> 
    </TooltipProvider>
  );
}