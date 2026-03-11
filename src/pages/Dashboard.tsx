import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Users, Upload, ExternalLink, CheckCircle2, Loader2, RefreshCw, Unplug, Calendar, Clock, Building2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useTenantSettings } from "@/hooks/useTenantSettings";

export default function Dashboard() {
  const [stats, setStats] = useState({ structures: 0, entities: 0, imports: 0 });
  const [recentStructures, setRecentStructures] = useState<{ id: string; name: string; updated_at: string }[]>([]);
  const [xeroConnection, setXeroConnection] = useState<{
    id: string;
    connected_at: string | null;
    expires_at: string;
    xero_tenant_id: string | null;
    xero_org_name: string | null;
    connected_by_email: string | null;
  } | null>(null);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [debugData, setDebugData] = useState<{ connections: any; contacts: any } | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { currentUser, loading: usersLoading } = useTenantUsers();
  const { tenant, loading: tenantLoading } = useTenantSettings();

  const permissionsLoaded = !usersLoading && !tenantLoading;
  const userRole = currentUser?.role ?? null;
  const canManageIntegrations = permissionsLoaded && (userRole === "owner" || (userRole === "admin" && currentUser?.can_manage_integrations === true));

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

      // Check Xero connection status via secure RPC (no token exposure)
      const { data: xeroData } = await supabase.rpc("get_xero_connection_info");
      setXeroConnection(xeroData && xeroData !== 'null' ? xeroData as any : null);
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
        body: JSON.stringify({ origin: window.location.origin }),
      });

      const responseText = await res.text();
      console.log("[Xero OAuth] Raw response status:", res.status);
      console.log("[Xero OAuth] Raw response body:", responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error("[Xero OAuth] Failed to parse response as JSON:", responseText);
        throw new Error(`Non-JSON response (${res.status}): ${responseText.substring(0, 200)}`);
      }
      
      console.log("[Xero OAuth] Parsed response:", data);
      
      const oauthUrl = data.auth_url || data.url;
      if (!res.ok || !oauthUrl) {
        console.error("[Xero OAuth] Error details:", { status: res.status, data });
        throw new Error(data.error || `Failed to start Xero auth (status ${res.status})`);
      }

      console.log("[Xero OAuth] Redirecting to:", oauthUrl);
      window.location.href = oauthUrl;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setXeroLoading(false);
    }
  };

  const handleSyncXpm = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-xpm");
      if (error) throw error;
      toast({
        title: "XPM Sync Complete",
        description: `${data.entitiesCreated ?? 0} entities created, ${data.entitiesUpdated ?? 0} updated, ${data.relationshipsCreated ?? 0} relationships created.`,
      });
      // Reload stats
      const [s, e, i] = await Promise.all([
        supabase.from("structures").select("id", { count: "exact", head: true }),
        supabase.from("entities").select("id", { count: "exact", head: true }),
        supabase.from("import_logs").select("id", { count: "exact", head: true }),
      ]);
      setStats({ structures: s.count ?? 0, entities: e.count ?? 0, imports: i.count ?? 0 });
    } catch (err: any) {
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnectXero = async () => {
    if (!xeroConnection) return;
    setDisconnecting(true);
    try {
      const { data: result, error } = await supabase.rpc("disconnect_xero_connection", {
        p_connection_id: xeroConnection.id,
      });
      if (error) throw error;
      setXeroConnection(null);
      toast({ title: "Xero Disconnected", description: "You can reconnect at any time." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleFetchDebug = async () => {
    setDebugLoading(true);
    setDebugData(null);
    try {
      const { data, error } = await supabase.functions.invoke("xero-debug");
      if (error) throw error;
      setDebugData(data);
    } catch (err: any) {
      toast({ title: "Debug Fetch Failed", description: err.message, variant: "destructive" });
    } finally {
      setDebugLoading(false);
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

      {/* Xero Connection Card - only for owners (and admins if permitted) */}
      {canManageIntegrations && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Xero Practice Manager</CardTitle>
            {xeroConnection && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {xeroConnection ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {xeroConnection.xero_org_name && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Organisation: <span className="font-medium text-foreground">{xeroConnection.xero_org_name}</span></span>
                    </div>
                  )}
                  {xeroConnection.connected_by_email && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span>Connected by: {xeroConnection.connected_by_email}</span>
                    </div>
                  )}
                  {xeroConnection.connected_at && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>Connected: {new Date(xeroConnection.connected_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {xeroConnection.expires_at && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>Token expires: {new Date(xeroConnection.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={handleSyncXpm} disabled={syncing} variant="outline" className="gap-2">
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {syncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button onClick={handleDisconnectXero} disabled={disconnecting} variant="ghost" size="sm" className="gap-2 text-destructive hover:text-destructive">
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                    Disconnect
                  </Button>
                </div>
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">Debug: Raw Xero API Responses (Temporary)</h3>
                    <Button onClick={handleFetchDebug} disabled={debugLoading} variant="outline" size="sm" className="gap-2">
                      {debugLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Fetch Contacts
                    </Button>
                  </div>
                  {debugData && (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold mb-1">GET /connections</p>
                        <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-60">
                          {JSON.stringify(debugData.connections, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs font-semibold mb-1">GET /api.xro/2.0/Contacts</p>
                        <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-96">
                          {JSON.stringify(debugData.contacts, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground flex-1">
                  Connect to Xero Practice Manager to import client relationships.
                </p>
                <Button onClick={handleConnectXero} disabled={xeroLoading} className="gap-2">
                  {xeroLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Connect to Xero
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
