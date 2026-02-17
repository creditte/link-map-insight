import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Network, Trash2, RotateCcw, History, Copy } from "lucide-react";
import { HealthBadgeV2 } from "@/components/structure/StructureHealthPanel";
import { computeHealthScoreV2Light } from "@/lib/structureScoring";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import { getSnapshotCount } from "@/hooks/useSnapshots";

interface Structure {
  id: string;
  name: string;
  updated_at: string;
  deleted_at: string | null;
  is_scenario: boolean;
  scenario_label: string | null;
  parent_structure_id: string | null;
}

type SortOption = "updated" | "name" | "health_asc" | "health_desc";
type FilterOption = "all" | "live" | "scenarios";

export default function Structures() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [structures, setStructures] = useState<Structure[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Structure | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("updated");
  const [filterMode, setFilterMode] = useState<FilterOption>("all");

  const [healthMap, setHealthMap] = useState<Map<string, { score: number; displayScore: number; label: string; status: "good" | "warning" | "critical" }>>(new Map());
  const [snapshotCounts, setSnapshotCounts] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("structures")
      .select("id, name, updated_at, deleted_at, is_scenario, scenario_label, parent_structure_id")
      .order("updated_at", { ascending: false });

    if (!showDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data } = await query;
    const structs = (data as Structure[]) ?? [];
    setStructures(structs);
    setLoading(false);

    // Load health scores and snapshot counts for active structures
    const activeIds = structs.filter((s) => !s.deleted_at).map((s) => s.id);
    if (activeIds.length === 0) return;

    // Snapshot counts
    getSnapshotCount(activeIds).then(setSnapshotCounts);

    // Fetch all structure_entities and structure_relationships
    const [seResult, srResult] = await Promise.all([
      supabase.from("structure_entities").select("structure_id, entity_id").in("structure_id", activeIds),
      supabase.from("structure_relationships").select("structure_id, relationship_id").in("structure_id", activeIds),
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

    // Collect all unique entity/relationship IDs
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

    // Compute health for each structure
    const newHealthMap = new Map<string, { score: number; displayScore: number; label: string; status: "good" | "warning" | "critical" }>();
    for (const sid of activeIds) {
      const entIds = seByStruct.get(sid) ?? [];
      const relIds = srByStruct.get(sid) ?? [];
      const ents = entIds.map((id) => entityById.get(id)).filter(Boolean) as EntityNode[];
      const rels = relIds.map((id) => relById.get(id)).filter(Boolean) as RelationshipEdge[];
      newHealthMap.set(sid, computeHealthScoreV2Light(ents, rels));
    }
    setHealthMap(newHealthMap);
  }, [showDeleted]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "admin" })
      .then(({ data }) => setIsAdmin(!!data));
  }, [user?.id]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from("structures")
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("id", deleteTarget.id);

    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Structure deleted", description: `"${deleteTarget.name}" has been removed` });
      load();
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleRestore = async (structure: Structure) => {
    const { error } = await supabase
      .from("structures")
      .update({ deleted_at: null } as any)
      .eq("id", structure.id);

    if (error) {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Structure restored", description: `"${structure.name}" has been restored` });
      load();
    }
  };

  const sorted = useMemo(() => {
    let filtered = structures.filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase())
    );
    // Apply scenario filter
    if (filterMode === "live") {
      filtered = filtered.filter((s) => !s.is_scenario);
    } else if (filterMode === "scenarios") {
      filtered = filtered.filter((s) => s.is_scenario);
    }
    switch (sortBy) {
      case "name":
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      case "health_asc":
        return [...filtered].sort((a, b) => (healthMap.get(a.id)?.score ?? 100) - (healthMap.get(b.id)?.score ?? 100));
      case "health_desc":
        return [...filtered].sort((a, b) => (healthMap.get(b.id)?.score ?? 100) - (healthMap.get(a.id)?.score ?? 100));
      default:
        return filtered;
    }
  }, [structures, search, sortBy, healthMap, filterMode]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Structures</h1>
        <div className="flex items-center gap-2">
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterOption)}>
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="Filter..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="live">Live only</SelectItem>
              <SelectItem value="scenarios">Scenarios</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Last updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="health_asc">Lowest health</SelectItem>
              <SelectItem value="health_desc">Highest health</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button
              variant={showDeleted ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setShowDeleted(!showDeleted)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {showDeleted ? "Hide deleted" : "Show deleted"}
            </Button>
          )}
        </div>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search structures..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No structures found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => {
            const isDeleted = !!s.deleted_at;
            const health = healthMap.get(s.id);
            return (
              <Card key={s.id} className={`group relative transition-colors ${isDeleted ? "opacity-60" : "hover:bg-accent/50"}`}>
                <CardContent className="flex items-center gap-3 p-4">
                  {isDeleted ? (
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Network className="h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate line-through">{s.name}</p>
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">Deleted</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Deleted {new Date(s.deleted_at!).toLocaleDateString()}
                        </p>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 shrink-0"
                          onClick={() => handleRestore(s)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <Link to={`/structures/${s.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <Network className="h-5 w-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{s.name}</p>
                            {s.is_scenario && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
                                <Copy className="h-2.5 w-2.5" /> Scenario
                              </Badge>
                            )}
                            {health && <HealthBadgeV2 displayScore={health.displayScore} label={health.label} status={health.status} />}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">
                              Updated {new Date(s.updated_at).toLocaleDateString()}
                            </p>
                            {(snapshotCounts.get(s.id) ?? 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <History className="h-2.5 w-2.5" />
                                {snapshotCounts.get(s.id)} snapshot{snapshotCounts.get(s.id)! > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={(e) => { e.preventDefault(); setDeleteTarget(s); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete structure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <span className="font-medium">"{deleteTarget?.name}"</span> from your
              structures list. The underlying entities and relationships will not be affected.
              {isAdmin && " Admins can restore deleted structures later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
