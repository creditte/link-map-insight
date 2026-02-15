import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPES, getEntityLabel, getEntityIcon } from "@/lib/entityTypes";

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
  const [entities, setEntities] = useState<UnresolvedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("entities")
      .select("id, name, entity_type, xpm_uuid, source")
      .eq("entity_type", "Unclassified")
      .order("name");

    setEntities((data ?? []) as UnresolvedEntity[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpdateType = async (entityId: string, newType: string) => {
    setSaving(entityId);
    const { error } = await supabase.from("entities").update({ entity_type: newType } as any).eq("id", entityId);
    if (error) {
      console.error("Entity type update failed:", error);
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entity updated" });
      setEntities((prev) => prev.filter((e) => e.id !== entityId));
    }
    setSaving(null);
  };

  const unresolvedCount = entities.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Review & Fix</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="flex gap-3">
        <Card className="flex-1">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{unresolvedCount}</p>
              <p className="text-xs text-muted-foreground">Unresolved entities</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entities.length === 0 ? (
        <Card className="max-w-lg">
          <CardContent className="flex items-center gap-3 p-6">
            <CheckCircle className="h-6 w-6 text-primary" />
            <div>
              <p className="font-medium">All clear!</p>
              <p className="text-sm text-muted-foreground">
                No unclassified entities. Structures are ready for export.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entities.map((entity) => {
            const Icon = getEntityIcon(entity.entity_type);

            return (
              <Card key={entity.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{entity.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {getEntityLabel(entity.entity_type)}
                        </Badge>
                        {entity.xpm_uuid && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                            {entity.xpm_uuid}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      onValueChange={(v) => handleUpdateType(entity.id, v)}
                      disabled={saving === entity.id}
                    >
                      <SelectTrigger className="w-[200px] h-9">
                        <SelectValue placeholder="Select entity type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPES.filter(t => t !== "Unclassified").map((t) => (
                          <SelectItem key={t} value={t}>
                            {getEntityLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Export blocking notice */}
      {entities.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Export blocked</p>
              <p className="text-xs text-muted-foreground">
                All entities must be classified before structures can be exported. Resolve the{" "}
                {entities.length} remaining {entities.length === 1 ? "entity" : "entities"} above.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
