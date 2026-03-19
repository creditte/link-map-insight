import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ArrowRight,
  Loader2,
  Sparkles,
  Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPES, getEntityLabel, getEntityIcon } from "@/lib/entityTypes";
import DuplicatesTab from "@/components/review/DuplicatesTab";

interface UnresolvedEntity {
  id: string;
  name: string;
  entity_type: string;
  xpm_uuid: string | null;
  source: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-0",
  warning: "bg-warning/10 text-warning border-0",
  minor: "bg-muted text-muted-foreground border-0",
};

export default function Review() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entities, setEntities] = useState<UnresolvedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("entities")
      .select("id, name, entity_type, xpm_uuid, source")
      .eq("entity_type", "Unclassified")
      .is("deleted_at", null)
      .order("name");
    setEntities((data ?? []) as UnresolvedEntity[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpdateType = async (entityId: string, newType: string) => {
    setSaving(entityId);
    const { error } = await supabase
      .from("entities")
      .update({ entity_type: newType } as any)
      .eq("id", entityId);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity updated" });
      setEntities((prev) => prev.filter((e) => e.id !== entityId));
    }
    setSaving(null);
  };

  const unresolvedCount = entities.length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      {/* ── Header ── */}
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Review &amp; Improve
        </h1>
        <p className="text-base text-muted-foreground max-w-lg">
          Review flagged issues and improve structure quality.
        </p>
      </section>

      {/* ── Tabs ── */}
      <Tabs defaultValue="unresolved" className="space-y-6">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="unresolved" className="gap-1.5 rounded-lg text-xs">
            <AlertTriangle className="h-3.5 w-3.5" />
            Unresolved
            {unresolvedCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 bg-destructive/10 text-destructive border-0">
                {unresolvedCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="gap-1.5 rounded-lg text-xs">
            <Copy className="h-3.5 w-3.5" />
            Duplicates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unresolved" className="space-y-6">
          {/* Summary */}
          {!loading && unresolvedCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 px-5 py-3.5">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <span className="text-sm text-foreground">
                <span className="font-semibold">{unresolvedCount} unclassified entit{unresolvedCount === 1 ? "y" : "ies"}</span>{" "}
                — classify to unlock exports and improve health scores.
              </span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : entities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-card px-8 py-16 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-success/10">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">All clear</h3>
              <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
                No unclassified entities. Your structures are ready for export.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entities.map((entity) => {
                const Icon = getEntityIcon(entity.entity_type);
                return (
                  <div
                    key={entity.id}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4 transition-all hover:border-border"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{entity.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-destructive/10 text-destructive border-0">
                            Unclassified
                          </Badge>
                          {entity.xpm_uuid && (
                            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[100px]">
                              {entity.xpm_uuid}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Select
                        onValueChange={(v) => handleUpdateType(entity.id, v)}
                        disabled={saving === entity.id}
                      >
                        <SelectTrigger className="w-[180px] h-9 rounded-lg text-xs">
                          <SelectValue placeholder="Classify as…" />
                        </SelectTrigger>
                        <SelectContent>
                          {ENTITY_TYPES.filter((t) => t !== "Unclassified").map((t) => (
                            <SelectItem key={t} value={t}>
                              {getEntityLabel(t)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {saving === entity.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {entities.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl bg-destructive/5 border border-destructive/15 px-5 py-3.5">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Export blocked</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All entities must be classified before structures can be exported.
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
