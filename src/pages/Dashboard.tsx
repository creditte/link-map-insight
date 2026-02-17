import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Users, Upload, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [stats, setStats] = useState({ structures: 0, entities: 0, imports: 0 });
  const [recentStructures, setRecentStructures] = useState<{ id: string; name: string; updated_at: string }[]>([]);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    // Handle Xero OAuth callback params
    const xeroStatus = searchParams.get("xero");
    if (xeroStatus === "connected") {
      toast({ title: "Xero Connected", description: "Successfully connected to Xero Practice Manager." });
      setSearchParams({}, { replace: true });
    } else if (xeroStatus === "error") {
      const reason = searchParams.get("reason") || "unknown";
      toast({ title: "Xero Connection Failed", description: `Error: ${reason}`, variant: "destructive" });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, toast]);

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

      // Check Xero connection status
      const { data: xeroData } = await supabase
        .from("xero_connections")
        .select("id")
        .limit(1);
      setXeroConnected((xeroData?.length ?? 0) > 0);
    }
    load();
  }, []);

  const handleConnectXero = async () => {
    setXeroLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", variant: "destructive" });
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      const data = await res.json();
      console.log("[Xero OAuth] Response:", data);
      
      const oauthUrl = data.auth_url || data.url;
      if (!res.ok || !oauthUrl) {
        throw new Error(data.error || "Failed to start Xero auth");
      }

      console.log("[Xero OAuth] Full authorization URL:", oauthUrl);
      window.location.href = oauthUrl;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setXeroLoading(false);
    }
  };

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

      {/* Xero Connection Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Xero Practice Manager</CardTitle>
          {xeroConnected && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {xeroConnected ? (
            <p className="text-sm text-muted-foreground">
              Your Xero Practice Manager account is connected. Client data can be synced.
            </p>
          ) : (
            <div className="flex items-center gap-4">
              <p className="text-sm text-muted-foreground flex-1">
                Connect to Xero Practice Manager to import client relationships.
              </p>
              <Button onClick={handleConnectXero} disabled={xeroLoading} className="gap-2">
                {xeroLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Connect to Xero
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
