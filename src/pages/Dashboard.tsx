import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Network, Users, Upload } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({ structures: 0, entities: 0, imports: 0 });
  const [recentStructures, setRecentStructures] = useState<{ id: string; name: string; updated_at: string }[]>([]);

  useEffect(() => {
    async function load() {
      const [s, e, i, recent] = await Promise.all([
        supabase.from("structures").select("id", { count: "exact", head: true }),
        supabase.from("entities").select("id", { count: "exact", head: true }),
        supabase.from("import_logs").select("id", { count: "exact", head: true }),
        supabase.from("structures").select("id, name, updated_at").order("updated_at", { ascending: false }).limit(5),
      ]);
      setStats({
        structures: s.count ?? 0,
        entities: e.count ?? 0,
        imports: i.count ?? 0,
      });
      setRecentStructures((recent.data as any) ?? []);
    }
    load();
  }, []);

  const statCards = [
    { label: "Structures", value: stats.structures, icon: Network },
    { label: "Entities", value: stats.entities, icon: Users },
    { label: "Imports", value: stats.imports, icon: Upload },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Structures</CardTitle>
        </CardHeader>
        <CardContent>
          {recentStructures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No structures yet. Import a report to get started.</p>
          ) : (
            <ul className="space-y-2">
              {recentStructures.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/structures/${s.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
