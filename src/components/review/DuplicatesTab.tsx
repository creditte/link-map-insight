import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import { CheckCircle, Merge, ArrowRight, Loader2 } from "lucide-react";
import { getEntityLabel } from "@/lib/entityTypes";

interface DuplicateGroup {
  normalizedName: string;
  entities: { id: string; name: string; type: string }[];
}

interface ImpactedRelationship {
  id: string;
  relationship_type: string;
  from_name: string;
  to_name: string;
  from_entity_id: string;
  to_entity_id: string;
}

export default function DuplicatesTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Merge dialog state
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [impactedRels, setImpactedRels] = useState<ImpactedRelationship[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    // Get tenant_id from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id ?? "")
      .single();

    if (!profile) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc("find_duplicate_entities", {
      _tenant_id: profile.tenant_id,
    });

    if (error) {
      console.error("Duplicate search failed:", error);
      toast({ title: "Failed to find duplicates", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Group by normalized_name
    const groupMap = new Map<string, Map<string, { id: string; name: string; type: string }>>();
    for (const row of data ?? []) {
      const key = row.normalized_name;
      if (!groupMap.has(key)) groupMap.set(key, new Map());
      const m = groupMap.get(key)!;
      m.set(row.entity_id_a, { id: row.entity_id_a, name: row.name_a, type: row.type_a });
      m.set(row.entity_id_b, { id: row.entity_id_b, name: row.name_b, type: row.type_b });
    }

    const result: DuplicateGroup[] = [];
    for (const [normalizedName, entMap] of groupMap) {
      result.push({ normalizedName, entities: Array.from(entMap.values()) });
    }

    setGroups(result);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => {
    if (user?.id) loadDuplicates();
  }, [user?.id, loadDuplicates]);

  const openMergeDialog = (group: DuplicateGroup) => {
    setMergeGroup(group);
    setPrimaryId(group.entities[0].id);
    setImpactedRels([]);
  };

  // Load impacted relationships when primary changes
  const loadPreview = useCallback(async () => {
    if (!mergeGroup || !primaryId) return;
    setLoadingPreview(true);

    const duplicateIds = mergeGroup.entities.filter((e) => e.id !== primaryId).map((e) => e.id);
    if (duplicateIds.length === 0) {
      setImpactedRels([]);
      setLoadingPreview(false);
      return;
    }

    // Find all relationships involving duplicate entities
    const { data: rels } = await supabase
      .from("relationships")
      .select("id, relationship_type, from_entity_id, to_entity_id")
      .is("deleted_at", null)
      .or(
        duplicateIds.map((id) => `from_entity_id.eq.${id}`).join(",") +
          "," +
          duplicateIds.map((id) => `to_entity_id.eq.${id}`).join(",")
      );

    if (!rels || rels.length === 0) {
      setImpactedRels([]);
      setLoadingPreview(false);
      return;
    }

    // Get entity names for display
    const allEntityIds = new Set<string>();
    for (const r of rels) {
      allEntityIds.add(r.from_entity_id);
      allEntityIds.add(r.to_entity_id);
    }
    const { data: entNames } = await supabase
      .from("entities")
      .select("id, name")
      .in("id", Array.from(allEntityIds));
    const nameMap = new Map((entNames ?? []).map((e) => [e.id, e.name]));

    setImpactedRels(
      rels.map((r) => ({
        id: r.id,
        relationship_type: r.relationship_type,
        from_name: nameMap.get(r.from_entity_id) ?? "Unknown",
        to_name: nameMap.get(r.to_entity_id) ?? "Unknown",
        from_entity_id: r.from_entity_id,
        to_entity_id: r.to_entity_id,
      }))
    );
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
      for (const dupId of duplicateIds) {
        // Reassign relationships: from_entity_id
        await supabase
          .from("relationships")
          .update({ from_entity_id: primaryId } as any)
          .eq("from_entity_id", dupId)
          .is("deleted_at", null);

        // Reassign relationships: to_entity_id
        await supabase
          .from("relationships")
          .update({ to_entity_id: primaryId } as any)
          .eq("to_entity_id", dupId)
          .is("deleted_at", null);

        // Reassign structure_entities links
        // First check if primary already linked to same structures
        const { data: dupLinks } = await supabase
          .from("structure_entities")
          .select("structure_id")
          .eq("entity_id", dupId);

        const { data: primaryLinks } = await supabase
          .from("structure_entities")
          .select("structure_id")
          .eq("entity_id", primaryId);

        const primaryStructures = new Set((primaryLinks ?? []).map((l) => l.structure_id));

        for (const link of dupLinks ?? []) {
          if (!primaryStructures.has(link.structure_id)) {
            await supabase
              .from("structure_entities")
              .insert({ structure_id: link.structure_id, entity_id: primaryId });
          }
        }

        // Remove duplicate's structure links
        await supabase
          .from("structure_entities")
          .delete()
          .eq("entity_id", dupId);

        // Soft-delete the duplicate entity
        await supabase
          .from("entities")
          .update({
            deleted_at: new Date().toISOString(),
            merged_into_entity_id: primaryId,
          } as any)
          .eq("id", dupId);
      }

      toast({ title: "Entities merged successfully" });
      setMergeGroup(null);
      loadDuplicates();
    } catch (err: any) {
      console.error("Merge failed:", err);
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    }

    setMerging(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Scanning for duplicates...</p>;
  }

  if (groups.length === 0) {
    return (
      <Card className="max-w-lg">
        <CardContent className="flex items-center gap-3 p-6">
          <CheckCircle className="h-6 w-6 text-primary" />
          <div>
            <p className="font-medium">No duplicates found</p>
            <p className="text-sm text-muted-foreground">
              All entity names are unique after normalization.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {groups.map((group) => (
          <Card key={group.normalizedName}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground mb-2">
                    Normalized: <span className="font-mono">{group.normalizedName}</span>
                  </p>
                  <div className="space-y-1.5">
                    {group.entities.map((e) => (
                      <div key={e.id} className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{e.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {getEntityLabel(e.type)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => openMergeDialog(group)}
                >
                  <Merge className="h-3.5 w-3.5" /> Merge
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Merge Dialog */}
      <Dialog open={!!mergeGroup} onOpenChange={(open) => !open && setMergeGroup(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge Entities</DialogTitle>
            <DialogDescription>
              Choose the primary entity to keep. All relationships and structure links from
              duplicates will be reassigned to the primary. Duplicates will be soft-deleted.
            </DialogDescription>
          </DialogHeader>

          {mergeGroup && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Select Primary Entity
                </Label>
                <RadioGroup value={primaryId} onValueChange={setPrimaryId}>
                  {mergeGroup.entities.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-md border p-3">
                      <RadioGroupItem value={e.id} id={`primary-${e.id}`} />
                      <Label htmlFor={`primary-${e.id}`} className="flex-1 cursor-pointer">
                        <span className="text-sm font-medium">{e.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-2">
                          {getEntityLabel(e.type)}
                        </Badge>
                      </Label>
                      {e.id === primaryId && (
                        <Badge className="text-[10px] px-1.5 py-0">Primary</Badge>
                      )}
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Impacted relationships preview */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Impacted Relationships ({loadingPreview ? "..." : impactedRels.length})
                </Label>
                {loadingPreview ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
                  </div>
                ) : impactedRels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No relationships will be reassigned.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border p-2">
                    {impactedRels.map((r) => (
                      <div key={r.id} className="flex items-center gap-1.5 text-xs">
                        <span className="truncate max-w-[120px]">{r.from_name}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[120px]">{r.to_name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                          {r.relationship_type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeGroup(null)} disabled={merging}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={merging || !primaryId}>
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" /> Merging...
                </>
              ) : (
                "Confirm Merge"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
