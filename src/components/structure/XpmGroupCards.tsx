import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Users, RefreshCw, AlertCircle, PenLine, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface XpmGroup {
  xpm_uuid: string;
  name: string;
}

interface XpmGroupCardsProps {
  onSelectGroup: (group: XpmGroup) => void;
  selectedGroupId?: string | null;
}

export default function XpmGroupCards({ onSelectGroup, selectedGroupId }: XpmGroupCardsProps) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<XpmGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);

  async function loadFromDb() {
    const { data } = await supabase
      .from("xpm_groups")
      .select("xpm_uuid, name")
      .order("name", { ascending: true });
    return (data as XpmGroup[]) ?? [];
  }

  async function fetchFromXpm() {
    setSyncing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("list-xpm-groups");
      if (fnError) throw fnError;
      if (data?.error && (!data?.groups || data.groups.length === 0)) {
        setError(data.error);
        return;
      }
      const fetchedGroups = (data?.groups ?? []) as XpmGroup[];
      setGroups(fetchedGroups);
      if (fetchedGroups.length > 0) {
        toast.success(`${fetchedGroups.length} groups loaded from XPM`);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch groups");
      toast.error("Failed to fetch groups from XPM");
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportToEditor(e: React.MouseEvent, group: XpmGroup) {
    e.stopPropagation();
    setImportingId(group.xpm_uuid);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("import-xpm-group", {
        body: { group_uuid: group.xpm_uuid, group_name: group.name },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      
      toast.success(`Imported ${data.entities_count} entities and ${data.relationships_count} relationships`);
      navigate(`/structures/${data.structure_id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to import group");
    } finally {
      setImportingId(null);
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      const cached = await loadFromDb();
      if (cached.length > 0) {
        setGroups(cached);
        setLoading(false);
        return;
      }
      setLoading(false);
      await fetchFromXpm();
    }
    init();
  }, []);

  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Client Groups</h2>
          {groups.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {groups.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter groups..."
                className="h-8 pl-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={fetchFromXpm}
            disabled={syncing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && groups.length === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {groups.length === 0 && !error && !syncing && (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No client groups found</p>
          <p className="text-xs mt-1">Connect XPM Practice Manager and click Refresh to load groups.</p>
        </div>
      )}

      {/* Syncing state */}
      {syncing && groups.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching groups from XPM...</span>
        </div>
      )}

      {/* Group cards grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((g) => (
            <Card
              key={g.xpm_uuid}
              className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 group ${
                selectedGroupId === g.xpm_uuid
                  ? "ring-2 ring-primary bg-accent/30"
                  : "hover:bg-accent/30"
              }`}
              onClick={() => onSelectGroup(g)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm font-semibold truncate text-foreground">{g.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Client Group</p>
                    </div>
                  </div>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
                        onClick={(e) => handleImportToEditor(e, g)}
                        disabled={importingId === g.xpm_uuid}
                      >
                        {importingId === g.xpm_uuid ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PenLine className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Open in Editor
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium border-primary/30 text-primary bg-primary/5">
                    XPM
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* No search results */}
      {filtered.length === 0 && groups.length > 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">No groups match your search.</p>
      )}
    </div>
  );
}
