import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ArrowRight,
  Upload,
  HeartPulse,
  Sparkles,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Unplug,
  Network,
  Eye,
  AlertTriangle,
  Zap,
  Share2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const [recentStructures, setRecentStructures] = useState<
    { id: string; name: string; updated_at: string }[]
  >([]);
  const [structureCount, setStructureCount] = useState(0);
  const [xeroConnection, setXeroConnection] = useState<{
    id: string;
    connected_at: string | null;
    expires_at: string;
    xero_tenant_id: string | null;
    xero_org_name: string | null;
    connected_by_email: string | null;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentUser, loading: usersLoading } = useTenantUsers();
  const { tenant, loading: tenantLoading } = useTenantSettings();

  const permissionsLoaded = !usersLoading && !tenantLoading;
  const userRole = currentUser?.role ?? null;
  const canManageIntegrations =
    permissionsLoaded &&
    (userRole === "owner" ||
      (userRole === "admin" &&
        currentUser?.can_manage_integrations === true));

  // Handle Xero OAuth callback
  useEffect(() => {
    const xeroStatus = searchParams.get("xero");
    if (xeroStatus === "connected") {
      toast({
        title: "Xero Connected",
        description: "Successfully connected to Xero Practice Manager.",
      });
      setSearchParams({}, { replace: true });
    } else if (xeroStatus === "error") {
      const reason = searchParams.get("reason") || "unknown";
      toast({
        title: "Xero Connection Failed",
        description: `Error: ${reason}`,
        variant: "destructive",
      });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, toast]);

  // Load data
  useEffect(() => {
    async function load() {
      const [sCount, recent, xeroData] = await Promise.all([
        supabase
          .from("structures")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null),
        supabase
          .from("structures")
          .select("id, name, updated_at")
          .is("deleted_at", null)
          .eq("is_scenario", false)
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase.rpc("get_xero_connection_info"),
      ]);
      setStructureCount(sCount.count ?? 0);
      setRecentStructures((recent.data as any) ?? []);
      setXeroConnection(
        xeroData.data && xeroData.data !== "null"
          ? (xeroData.data as any)
          : null
      );
    }
    load();
  }, []);

  const handleConnectXero = async () => {
    setXeroLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", variant: "destructive" });
        return;
      }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-auth`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ origin: window.location.origin }),
        }
      );
      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Non-JSON response (${res.status}): ${responseText.substring(0, 200)}`
        );
      }
      const oauthUrl = data.auth_url || data.url;
      if (!res.ok || !oauthUrl)
        throw new Error(
          data.error || `Failed to start Xero auth (status ${res.status})`
        );
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
        description: `${data.contactsFetched ?? 0} contacts fetched, ${data.entitiesCreated ?? 0} created, ${data.entitiesUpdated ?? 0} updated.`,
      });
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
      const { error } = await supabase.rpc("disconnect_xero_connection", {
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

  const hasStructures = structureCount > 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-10">
      {/* ── Hero Section ── */}
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Build a structure
          </h1>
          <p className="mt-1.5 text-muted-foreground">
            Create a clean, visual structure for your client in minutes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="lg"
            className="gap-2 shadow-sm"
            onClick={() => navigate("/structures")}
          >
            <Plus className="h-4 w-4" />
            Create New Structure
          </Button>
          {canManageIntegrations && !xeroConnection && (
            <Button
              variant="outline"
              size="lg"
              className="gap-2"
              onClick={handleConnectXero}
              disabled={xeroLoading}
            >
              {xeroLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import from Xero
            </Button>
          )}
        </div>
      </section>

      {/* ── Recent Structures or Empty State ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Recent Structures
          </h2>
          {hasStructures && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              asChild
            >
              <Link to="/structures">
                View All <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>

        {hasStructures ? (
          <div className="grid gap-2">
            {recentStructures.map((s) => (
              <Link
                key={s.id}
                to={`/structures/${s.id}`}
                className="group flex items-center justify-between rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                    <Network className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(s.updated_at), {
                    addSuffix: true,
                  })}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Network className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">
                Create your first structure
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5" /> Visualise ownership clearly
                </li>
                <li className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" /> Spot risks faster
                </li>
                <li className="flex items-center gap-2">
                  <Share2 className="h-3.5 w-3.5" /> Share with clients easily
                </li>
              </ul>
              <Button
                className="mt-6 gap-2"
                onClick={() => navigate("/structures")}
              >
                <Plus className="h-4 w-4" />
                Create New Structure
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Health Check & Review Cards ── */}
      <section className="grid gap-4 sm:grid-cols-2">
        {/* Health Check */}
        <Card className="group relative overflow-hidden">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10">
                <HeartPulse className="h-5 w-5 text-success" />
              </div>
              <h3 className="font-semibold">Health Check</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Assess the health of client structures and identify issues quickly.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 mt-1"
              asChild
            >
              <Link to="/governance">
                Run Health Check <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Review & Improve */}
        <Card className="group relative overflow-hidden">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">Review &amp; Improve</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Review flagged issues and improve structure quality.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 mt-1"
              asChild
            >
              <Link to="/review">
                Review Issues <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ── Xero Integration Status (de-emphasised) ── */}
      {canManageIntegrations && xeroConnection && (
        <section>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className="gap-1 bg-success/10 text-success border-0"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Xero Connected
                </Badge>
                {xeroConnection.xero_org_name && (
                  <span className="text-sm text-muted-foreground">
                    {xeroConnection.xero_org_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleSyncXpm}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {syncing ? "Syncing…" : "Sync Now"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={handleDisconnectXero}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unplug className="h-3.5 w-3.5" />
                  )}
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
