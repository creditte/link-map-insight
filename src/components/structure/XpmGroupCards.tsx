import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Users } from "lucide-react";

interface XpmGroup {
  id: string;
  xpm_uuid: string;
  name: string;
}

interface XpmGroupCardsProps {
  onSelectGroup: (group: XpmGroup) => void;
  selectedGroupId?: string | null;
}

export default function XpmGroupCards({ onSelectGroup, selectedGroupId }: XpmGroupCardsProps) {
  const [groups, setGroups] = useState<XpmGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("xpm_groups")
        .select("id, xpm_uuid, name")
        .order("name", { ascending: true });
      setGroups((data as XpmGroup[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-48 shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">XPM Groups</h2>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {groups.length}
          </Badge>
        </div>
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter groups..."
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {filtered.map((g) => (
          <Card
            key={g.id}
            className={`shrink-0 cursor-pointer transition-all hover:bg-accent/50 ${
              selectedGroupId === g.xpm_uuid
                ? "ring-2 ring-primary bg-accent/30"
                : ""
            }`}
            onClick={() => onSelectGroup(g)}
          >
            <CardContent className="flex items-center gap-3 p-4 min-w-[180px]">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-medium truncate max-w-[140px]">{g.name}</p>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-4">No groups match your search.</p>
        )}
      </div>
    </div>
  );
}
