import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Download,
  CircleDot,
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

export default function Review() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<UnresolvedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const initialCountRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("entities")
      .select("id, name, entity_type, xpm_uuid, source")
      .eq("entity_type", "Unclassified")
      .is("deleted_at", null)
      .order("name");
    const items = (data ?? []) as UnresolvedEntity[];
    setEntities(items);
    setResolvedIds(new Set());
    if (initialCountRef.current === null) {
      initialCountRef.current = items.length;
    }
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
      const name = entities.find((e) => e.id === entityId)?.name ?? "Entity";
      toast({ title: `${name} classified as ${getEntityLabel(newType)}` });
      setResolvedIds((prev) => new Set(prev).add(entityId));
      // Animate out then remove
      setTimeout(() => {
        setEntities((prev) => prev.filter((e) => e.id !== entityId));
      }, 400);
    }
    setSaving(null);
  };

  const unresolvedCount = entities.length;
  const totalIssues = initialCountRef.current ?? unresolvedCount;
  const resolvedCount = totalIssues - unresolvedCount;
  const progressPercent = totalIssues > 0 ? Math.round((resolvedCount / totalIssues) * 100) : 100;
  const allResolved = !loading && unresolvedCount === 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      {/* ── Header ── */}
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Review &amp; Improve
        </h1>
        {loading ? (
          <p className="text-base text-muted-foreground">Loading issues…</p>
        ) : allResolved ? (
          <p className="text-base text-muted-foreground">
            All issues resolved. Your structures are ready.
          </p>
        ) : (
          <p className="text-base text-muted-foreground">
            {unresolvedCount} issue{unresolvedCount !== 1 ? "s" : ""} to resolve.
            Complete these to finalise your structures and enable export.
          </p>
        )}
      </section>

      {/* ── Progress ── */}
      {!loading && totalIssues > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {allResolved ? "Complete" : `${progressPercent}% complete`}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {resolvedCount} / {totalIssues} resolved
            </span>
          </div>
          <Progress
            value={progressPercent}
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
            {unresolvedCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 bg-warning/10 text-warning border-0">
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
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning for issues…
            </div>
          ) : allResolved ? (
            /* ── Completion state ── */
            <div className="rounded-2xl border border-success/20 bg-success/5 px-8 py-14 text-center space-y-5">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xl font-semibold text-foreground">
                  All issues resolved
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Your structures are complete and ready to export.
                </p>
              </div>
              <Button
                size="lg"
                className="gap-2 rounded-xl px-6 text-sm font-medium"
                onClick={() => navigate("/structures")}
              >
                <Download className="h-4 w-4" />
                Export Structures
              </Button>
            </div>
          ) : (
            /* ── Issue list ── */
            <div className="space-y-2">
              {entities.map((entity) => {
                const Icon = getEntityIcon(entity.entity_type);
                const isResolving = resolvedIds.has(entity.id);
                return (
                  <div
                    key={entity.id}
                    className={`flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4 transition-all duration-300 hover:border-border ${
                      isResolving ? "opacity-0 scale-95" : "opacity-100 scale-100"
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                        <Icon className="h-4 w-4 text-warning" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {entity.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Missing entity type
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Select
                        onValueChange={(v) => handleUpdateType(entity.id, v)}
                        disabled={saving === entity.id}
                      >
                        <SelectTrigger className="w-[180px] h-9 rounded-lg text-xs">
                          <SelectValue placeholder="Select entity type" />
                        </SelectTrigger>
                        <SelectContent>
                          {ENTITY_TYPES.filter((t) => t !== "Unclassified").map((t) => (
                            <SelectItem key={t} value={t}>
                              {getEntityLabel(t)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {saving === entity.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Blocker message ── */}
          {!loading && unresolvedCount > 0 && (
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
