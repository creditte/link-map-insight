import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Share2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { useBilling } from "@/hooks/useBilling";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import BillingBanner from "@/components/BillingBanner";
import DiagramLimitDialog from "@/components/DiagramLimitDialog";
import CreateStructureModal from "@/components/structure/CreateStructureModal";

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
  const { billing } = useBilling();
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [xeroConnectionType, setXeroConnectionType] = useState<"accounting" | "practice_manager">("accounting");

  const handleCreateNew = () => {
    if (atDiagramLimit) {
      setShowLimitDialog(true);
    } else {
      setShowCreateModal(true);
    }
  };

  const atDiagramLimit = billing ? billing.diagram_count >= billing.diagram_limit : false;
  const permissionsLoaded = !usersLoading && !tenantLoading;
  const userRole = currentUser?.role ?? null;
  const canManageIntegrations =
    permissionsLoaded &&
    (userRole === "owner" ||
      (userRole === "admin" &&
        currentUser?.can_manage_integrations === true));

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
          body: JSON.stringify({ origin: window.location.origin, connection_type: xeroConnectionType }),
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

  // Compute last updated for hero summary
  const lastUpdated = recentStructures.length > 0
    ? formatDistanceToNow(new Date(recentStructures[0].updated_at), { addSuffix: true })
    : null;

  // Simple health dot — random for now (would come from real scoring data)
  const getHealthColor = (updatedAt: string) => {
    const days = differenceInDays(new Date(), new Date(updatedAt));
    if (days > 30) return "bg-destructive";
    if (days > 14) return "bg-warning";
    return "bg-success";
  };

  const isStale = (updatedAt: string) => differenceInDays(new Date(), new Date(updatedAt)) > 14;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-14">
      {/* ── Billing Banner ── */}
      <BillingBanner />

      {/* ── Hero Section ── */}
      <section className="space-y-5">
        {hasStructures ? (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                You have {structureCount} structure{structureCount !== 1 ? "s" : ""} — last updated {lastUpdated}
              </h1>
              <p className="text-sm text-muted-foreground max-w-md">
                Continue working on a recent structure or create a new one.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                className="gap-2 rounded-xl px-5 text-sm font-medium"
                onClick={handleCreateNew}
              >
                <Plus className="h-4 w-4" />
                Create New Structure
              </Button>
              {canManageIntegrations && !xeroConnection && (
                <div className="flex items-center gap-2">
                  <Select value={xeroConnectionType} onValueChange={(v) => setXeroConnectionType(v as "accounting" | "practice_manager")}>
                    <SelectTrigger className="h-9 w-[180px] rounded-xl text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounting">Accounting API</SelectItem>
                      <SelectItem value="practice_manager">Practice Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    className="gap-2 rounded-xl px-5 text-sm font-medium text-muted-foreground"
                    onClick={handleConnectXero}
                    disabled={xeroLoading}
                  >
                    {xeroLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Connect to Xero
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                Build a structure
              </h1>
              <p className="text-base text-muted-foreground max-w-md">
                Create a clean, visual structure for your client in minutes.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="lg"
                className="gap-2 rounded-xl px-6 text-sm font-medium shadow-sm"
                onClick={handleCreateNew}
              >
                <Plus className="h-4 w-4" />
                Create New Structure
              </Button>
              {canManageIntegrations && !xeroConnection && (
                <div className="flex items-center gap-2">
                  <Select value={xeroConnectionType} onValueChange={(v) => setXeroConnectionType(v as "accounting" | "practice_manager")}>
                    <SelectTrigger className="h-10 w-[180px] rounded-xl text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounting">Accounting API</SelectItem>
                      <SelectItem value="practice_manager">Practice Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="lg"
                    className="gap-2 rounded-xl px-6 text-sm font-medium"
                    onClick={handleConnectXero}
                    disabled={xeroLoading}
                  >
                    {xeroLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Connect to Xero
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Workflow Cards (moved above recent structures) ── */}
      <section className="grid gap-5 sm:grid-cols-2">
        {structureCount === 0 ? (
          <>
            <div className="rounded-2xl border border-border/60 bg-card p-6 opacity-50 cursor-not-allowed">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <HeartPulse className="h-5 w-5 text-success" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Health Check</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Assess the health of client structures and identify issues quickly.</p>
              <Button variant="secondary" size="sm" className="mt-4 gap-1.5 text-xs" disabled>
                Run Health Check <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-6 opacity-50 cursor-not-allowed">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Review &amp; Improve</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Review flagged issues and improve structure quality.</p>
              <Button variant="secondary" size="sm" className="mt-4 gap-1.5 text-xs" disabled>
                Review Issues <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <Link to="/governance" className="group rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border hover:shadow-sm">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <HeartPulse className="h-5 w-5 text-success" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Health Check</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Assess the health of client structures and identify issues quickly.</p>
              <Button size="sm" className="mt-4 gap-1.5 text-xs" asChild>
                <span>Run Health Check <ArrowRight className="h-3 w-3" /></span>
              </Button>
            </Link>
            <Link to="/review" className="group rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border hover:shadow-sm">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Review &amp; Improve</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Review flagged issues and improve structure quality.</p>
              <Button size="sm" className="mt-4 gap-1.5 text-xs" asChild>
                <span>Review Issues <ArrowRight className="h-3 w-3" /></span>
              </Button>
            </Link>
          </>
        )}
      </section>

      {/* ── Recent Structures ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Recent Structures
          </h2>
          {hasStructures && (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" asChild>
              <Link to="/structures">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </div>

        {hasStructures ? (
          <div className="space-y-1.5">
            {recentStructures.map((s) => {
              const stale = isStale(s.updated_at);
              return (
                <Link
                  key={s.id}
                  to={`/structures/${s.id}`}
                  className="group flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4 transition-all hover:border-border hover:shadow-sm"
                >
                  <div className="flex items-center gap-3.5">
                    {/* Health dot */}
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${getHealthColor(s.updated_at)}`} />
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/8">
                      <Network className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <span className={`text-sm font-medium ${stale ? "text-muted-foreground" : "text-foreground"}`}>
                        {s.name}
                      </span>
                      {stale && (
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5">Not recently updated</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(s.updated_at), {
                        addSuffix: true,
                      })}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/80 bg-card px-8 py-16 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/8">
              <Network className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Create your first structure
            </h3>
            <ul className="mt-4 inline-flex flex-col items-start gap-2.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <Eye className="h-4 w-4 text-primary/60" /> Visualise ownership
                clearly
              </li>
              <li className="flex items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-warning/70" /> Spot risks
                faster
              </li>
              <li className="flex items-center gap-2.5">
                <Share2 className="h-4 w-4 text-primary/60" /> Share with clients
                easily
              </li>
            </ul>
            <Button
              className="mt-8 gap-2 rounded-xl px-6"
              onClick={handleCreateNew}
            >
              <Plus className="h-4 w-4" />
              Create New Structure
            </Button>
          </div>
        )}
      </section>

      {/* ── Xero Status ── */}
      {canManageIntegrations && xeroConnection && (
        <section className="rounded-xl border-t border-border/60 bg-muted/30 px-5 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                variant="secondary"
                className="gap-1.5 rounded-md bg-success/10 text-success border-0 text-xs font-medium"
              >
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
              {xeroConnection.xero_org_name && (
                <span className="text-sm text-muted-foreground">
                  {xeroConnection.xero_org_name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleSyncXpm}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {syncing ? "Syncing…" : "Sync"}
              </Button>
              <button
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-50"
                onClick={handleDisconnectXero}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        </section>
      )}
      <DiagramLimitDialog open={showLimitDialog} onOpenChange={setShowLimitDialog} />
      <CreateStructureModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onImportXpm={() => {
          if (xeroConnection) {
            handleSyncXpm();
          } else {
            handleConnectXero();
          }
        }}
      />
    </div>
  );
}
