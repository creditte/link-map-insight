import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  SquareArrowOutUpRight,
  Eye,
  AlertTriangle,
  Share2,
  Building2,
  Users,
  Briefcase,
  Shield,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useSharedTenantSettings } from "@/contexts/TenantSettingsContext";
import { useDuplicateCount } from "@/hooks/useDuplicateCount";
import { useClientHealthReview } from "@/hooks/useClientHealthReview";

import { useBilling } from "@/hooks/useBilling";
import { formatDistanceToNow, differenceInDays, subDays } from "date-fns";
import BillingBanner from "@/components/BillingBanner";
import DiagramLimitDialog from "@/components/DiagramLimitDialog";
import CreateStructureModal from "@/components/structure/CreateStructureModal";

export default function Dashboard() {
  const [recentStructures, setRecentStructures] = useState<{ id: string; name: string; updated_at: string }[]>([]);
  const [structureCount, setStructureCount] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [importCount, setImportCount] = useState(0);
  const [entityStats, setEntityStats] = useState<{ type: string; count: number }[]>([]);
  const [totalEntities, setTotalEntities] = useState(0);
  const [trusteeCount, setTrusteeCount] = useState(0);
  const [weeklyTrends, setWeeklyTrends] = useState<{ structures: number; entities: number; imports: number }>({ structures: 0, entities: 0, imports: 0 });
  const [recentEntities, setRecentEntities] = useState<{ id: string; name: string; entity_type: string; is_trustee_company: boolean; abn: string | null; created_at: string }[]>([]);
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
  const { tenant, loading: tenantLoading } = useSharedTenantSettings();
  const { billing } = useBilling();
  const { duplicateCount } = useDuplicateCount();
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [xeroConnectionType, setXeroConnectionType] = useState<"accounting" | "practice_manager">("practice_manager");
  const { review, loading: healthLoading, runReview } = useClientHealthReview();

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
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";
  const canManageIntegrations =
    permissionsLoaded &&
    (userRole === "owner" || (userRole === "admin" && currentUser?.can_manage_integrations === true));

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
      setDashboardLoading(true);
      const [sCount, recent, xeroData, entitiesData, recentEnts, impCount] = await Promise.all([
        supabase.from("structures").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase
          .from("structures")
          .select("id, name, updated_at")
          .is("deleted_at", null)
          .eq("is_scenario", false)
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase.rpc("get_xero_connection_info"),
        supabase
          .from("entities")
          .select("entity_type, is_trustee_company")
          .is("deleted_at", null),
        supabase
          .from("entities")
          .select("id, name, entity_type, is_trustee_company, abn, created_at")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("import_logs").select("id", { count: "exact", head: true }),
      ]);
      setStructureCount(sCount.count ?? 0);
      setRecentStructures((recent.data as any) ?? []);
      setXeroConnection(xeroData.data && xeroData.data !== "null" ? (xeroData.data as any) : null);
      setImportCount(impCount.count ?? 0);

      // Process entity stats
      const entities = entitiesData.data ?? [];
      setTotalEntities(entities.length);
      setTrusteeCount(entities.filter((e: any) => e.is_trustee_company).length);
      const typeCounts: Record<string, number> = {};
      entities.forEach((e: any) => {
        const t = e.entity_type || "Unclassified";
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
      const stats = Object.entries(typeCounts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
      setEntityStats(stats);
      setRecentEntities((recentEnts.data as any) ?? []);

      // Fetch weekly trends
      const oneWeekAgo = subDays(new Date(), 7).toISOString();
      const [weekStructures, weekEntities, weekImports] = await Promise.all([
        supabase.from("structures").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", oneWeekAgo),
        supabase.from("entities").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", oneWeekAgo),
        supabase.from("import_logs").select("id", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
      ]);
      setWeeklyTrends({
        structures: weekStructures.count ?? 0,
        entities: weekEntities.count ?? 0,
        imports: weekImports.count ?? 0,
      });

      setDashboardLoading(false);
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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ origin: window.location.origin, connection_type: xeroConnectionType }),
      });
      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`Non-JSON response (${res.status}): ${responseText.substring(0, 200)}`);
      }
      const oauthUrl = data.auth_url || data.url;
      if (!res.ok || !oauthUrl) throw new Error(data.error || `Failed to start Xero auth (status ${res.status})`);
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
      const parts = [
        `${data.clientsFetched ?? data.contactsFetched ?? 0} clients fetched`,
        `${data.entitiesCreated ?? 0} created`,
        `${data.entitiesUpdated ?? 0} updated`,
      ];
      if (data.relationshipsCreated > 0) parts.push(`${data.relationshipsCreated} relationships created`);
      if (data.groupsCreated > 0) parts.push(`${data.groupsCreated} groups created`);
      if (data.staffFetched > 0) parts.push(`${data.staffFetched} staff fetched`);
      if (data.trusteesDetected > 0) parts.push(`${data.trusteesDetected} corporate trustees detected`);
      toast({ title: "XPM Sync Complete", description: parts.join(", ") + "." });
      // Refresh entity data
      const [entitiesData, recentEnts] = await Promise.all([
        supabase.from("entities").select("entity_type, is_trustee_company").is("deleted_at", null),
        supabase.from("entities").select("id, name, entity_type, is_trustee_company, abn, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
      ]);
      const entities = entitiesData.data ?? [];
      setTotalEntities(entities.length);
      setTrusteeCount(entities.filter((e: any) => e.is_trustee_company).length);
      const typeCounts: Record<string, number> = {};
      entities.forEach((e: any) => {
        const t = e.entity_type || "Unclassified";
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
      setEntityStats(Object.entries(typeCounts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count));
      setRecentEntities((recentEnts.data as any) ?? []);
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

  // Auto-run health review when structures are loaded
  useEffect(() => {
    if (!dashboardLoading && hasStructures && !review && !healthLoading) {
      runReview();
    }
  }, [dashboardLoading, hasStructures, review, healthLoading, runReview]);

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "Company":
        return <Building2 className="h-4 w-4 text-primary/70" />;
      case "Individual":
        return <Users className="h-4 w-4 text-blue-500/70" />;
      case "Trust":
      case "trust_discretionary":
      case "trust_unit":
      case "trust_hybrid":
      case "trust_bare":
      case "trust_testamentary":
      case "trust_deceased_estate":
      case "trust_family":
        return <Shield className="h-4 w-4 text-amber-500/70" />;
      case "smsf":
        return <Shield className="h-4 w-4 text-emerald-500/70" />;
      case "Partnership":
      case "Sole Trader":
        return <Briefcase className="h-4 w-4 text-violet-500/70" />;
      default:
        return <Building2 className="h-4 w-4 text-muted-foreground/50" />;
    }
  };

  const formatEntityType = (type: string) => {
    const map: Record<string, string> = {
      trust_discretionary: "Discretionary Trust",
      trust_unit: "Unit Trust",
      trust_hybrid: "Hybrid Trust",
      trust_bare: "Bare Trust",
      trust_testamentary: "Testamentary Trust",
      trust_deceased_estate: "Deceased Estate",
      trust_family: "Family Trust",
      smsf: "SMSF",
      "Sole Trader": "Sole Trader",
      "Incorporated Association/Club": "Association/Club",
    };
    return map[type] || type;
  };

  // Compute last updated for hero summary
  const lastUpdated =
    recentStructures.length > 0
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

      {/* ── Hero Section ── */}
      <section className="space-y-5">
        {dashboardLoading ? (
          <>
            <div className="space-y-2.5">
              <Skeleton className="h-8 w-[360px]" />
              <Skeleton className="h-4 w-[260px]" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-[200px] rounded-xl" />
            </div>
          </>
        ) : hasStructures ? (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                You have {structureCount} structure{structureCount !== 1 ? "s" : ""} — last updated {lastUpdated}
              </h1>
              <p className="text-sm text-muted-foreground max-w-md">
                Continue working on a recent structure or create a new one.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {isOwnerOrAdmin && (
                <Button variant="outline" className="gap-2 rounded-xl px-5 text-sm font-medium" onClick={handleCreateNew}>
                  <Plus className="h-4 w-4" />
                  Create New Structure
                </Button>
              )}
              {canManageIntegrations && !xeroConnection && (
                <div className="flex items-center gap-2">
                  <Select
                    value={xeroConnectionType}
                    onValueChange={(v) => setXeroConnectionType(v as "accounting" | "practice_manager")}
                  >
                    <SelectTrigger className="h-9 w-[180px] rounded-xl text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounting">Accounting API</SelectItem>
                      <SelectItem value="practice_manager">Practice Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    className="gap-2 rounded-xl px-5 text-sm font-medium"
                    onClick={handleConnectXero}
                    disabled={xeroLoading}
                  >
                    {xeroLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SquareArrowOutUpRight className="h-4 w-4" />
                    )}
                    Connect to Xero
                  </Button>
                </div>
              )}
              {canManageIntegrations && xeroConnection && (
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5">
                  <Badge
                    variant="secondary"
                    className="gap-1 rounded-md bg-success/10 text-success border-0 text-[11px] font-medium px-2 py-0.5"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </Badge>
                  {xeroConnection.xero_org_name && (
                    <span className="text-xs text-muted-foreground">{xeroConnection.xero_org_name}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2"
                    onClick={handleSyncXpm}
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {syncing ? "Syncing…" : "Sync"}
                  </Button>
                  <button
                    className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-50"
                    onClick={handleDisconnectXero}
                    disabled={disconnecting}
                  >
                    <Unplug className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">Build a structure</h1>
              <p className="text-base text-muted-foreground max-w-md">
                Create a clean, visual structure for your client in minutes.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {isOwnerOrAdmin && (
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 rounded-xl px-6 text-sm font-medium"
                  onClick={handleCreateNew}
                >
                  <Plus className="h-4 w-4" />
                  Create New Structure
                </Button>
              )}
              {canManageIntegrations && !xeroConnection && (
                <div className="flex items-center gap-2">
                  <Select
                    value={xeroConnectionType}
                    onValueChange={(v) => setXeroConnectionType(v as "accounting" | "practice_manager")}
                  >
                    <SelectTrigger className="h-10 w-[180px] rounded-xl text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounting">Accounting API</SelectItem>
                      <SelectItem value="practice_manager">Practice Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="lg"
                    className="gap-2 rounded-xl px-6 text-sm font-medium shadow-sm"
                    onClick={handleConnectXero}
                    disabled={xeroLoading}
                  >
                    {xeroLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SquareArrowOutUpRight className="h-4 w-4" />
                    )}
                    Connect to Xero
                  </Button>
                </div>
              )}
              {canManageIntegrations && xeroConnection && (
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5">
                  <Badge
                    variant="secondary"
                    className="gap-1 rounded-md bg-success/10 text-success border-0 text-[11px] font-medium px-2 py-0.5"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </Badge>
                  {xeroConnection.xero_org_name && (
                    <span className="text-xs text-muted-foreground">{xeroConnection.xero_org_name}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2"
                    onClick={handleSyncXpm}
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {syncing ? "Syncing…" : "Sync"}
                  </Button>
                  <button
                    className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-50"
                    onClick={handleDisconnectXero}
                    disabled={disconnecting}
                  >
                    <Unplug className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Billing Banner ── */}
      <BillingBanner />

      {/* ── Duplicate Entities Callout ── */}
      {duplicateCount > 0 && (
        <Link
          to="/review?tab=duplicates"
          className="group flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-5 py-3.5 transition-all hover:border-warning/50 hover:shadow-sm"
        >
          <Copy className="h-4 w-4 text-warning shrink-0" />
          <span className="flex-1 text-sm text-foreground">
            <span className="font-semibold">{duplicateCount} potential duplicate{duplicateCount !== 1 ? "s" : ""}</span>{" "}
            detected — review and merge to keep data clean.
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {/* ── Metric Cards ── */}
      <section className="grid gap-4 grid-cols-3">
        {[
          { icon: <Network className="h-4 w-4 text-primary/70" />, label: "Structures", value: structureCount, trend: weeklyTrends.structures, href: "/structures" },
          { icon: <Building2 className="h-4 w-4 text-primary/70" />, label: "Entities", value: totalEntities, trend: weeklyTrends.entities, href: "/review" },
          { icon: <Upload className="h-4 w-4 text-primary/70" />, label: "Imports", value: importCount, trend: weeklyTrends.imports, href: "/import" },
        ].map((card) => (
          <Link
            key={card.label}
            to={card.href}
            className="group rounded-2xl border border-border/60 bg-card px-5 py-4 space-y-1 transition-all hover:border-border hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              {card.icon}
              <span className="text-xs text-muted-foreground">{card.label}</span>
              <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground/0 transition-all group-hover:text-muted-foreground group-hover:translate-x-0.5" />
            </div>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-semibold text-foreground">{card.value}</p>
                {card.trend > 0 && (
                  <span className="text-[11px] font-medium text-primary">
                    ↑ {card.trend} this week
                  </span>
                )}
              </div>
            )}
          </Link>
        ))}
      </section>

      {/* ── Workflow Insight Cards ── */}
      <section className="grid gap-5 sm:grid-cols-2">
        {dashboardLoading ? (
          <>
            <Skeleton className="h-[200px] rounded-2xl" />
            <Skeleton className="h-[200px] rounded-2xl" />
          </>
        ) : structureCount === 0 ? (
          <>
            <div className="rounded-2xl border border-border/60 bg-card p-6 opacity-50 cursor-not-allowed">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <HeartPulse className="h-5 w-5 text-success" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Health Check</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Assess the health of client structures and identify issues quickly.
              </p>
              <Button variant="secondary" size="sm" className="mt-4 gap-1.5 text-xs" disabled>
                Run Health Check <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-6 opacity-50 cursor-not-allowed">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Review &amp; Improve</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Review flagged issues and improve structure quality.
              </p>
              <Button variant="secondary" size="sm" className="mt-4 gap-1.5 text-xs" disabled>
                Review Issues <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Health Check — live insight */}
            <Link
              to="/governance"
              className="group rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border hover:shadow-sm"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                  <HeartPulse className="h-5 w-5 text-success" />
                </div>
                {review && !healthLoading && (
                  <Badge
                    variant="outline"
                    className={`text-[11px] px-2 py-0.5 font-medium ${
                      review.clientScore >= 90
                        ? "border-success/40 text-success"
                        : review.clientScore >= 50
                        ? "border-warning/40 text-warning"
                        : "border-destructive/40 text-destructive"
                    }`}
                  >
                    Score {review.clientScore}
                  </Badge>
                )}
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Health Check</h3>
              {healthLoading ? (
                <div className="mt-2 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
              ) : review ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {review.criticalStructures > 0 ? (
                      <>
                        <span className="font-medium text-destructive">{review.criticalStructures} critical</span>
                        {review.needsAttention > 0 && (
                          <>, {review.needsAttention} need{review.needsAttention !== 1 ? "" : "s"} attention</>
                        )}
                      </>
                    ) : review.needsAttention > 0 ? (
                      <span className="font-medium text-warning">{review.needsAttention} structure{review.needsAttention !== 1 ? "s" : ""} need{review.needsAttention === 1 ? "s" : ""} attention</span>
                    ) : (
                      <span className="text-success font-medium">All structures healthy</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Last checked: {formatDistanceToNow(new Date(review.timestamp), { addSuffix: true })}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Assess the health of client structures and identify issues quickly.
                </p>
              )}
              <Button size="sm" className="mt-4 gap-1.5 text-xs" asChild>
                <span>
                  {review ? "View Details" : "Run Health Check"} <ArrowRight className="h-3 w-3" />
                </span>
              </Button>
            </Link>

            {/* Review & Improve — live insight */}
            <Link
              to="/review"
              className="group rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border hover:shadow-sm"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                {review && !healthLoading && review.allIssues.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[11px] px-2 py-0.5 font-medium border-warning/40 text-warning"
                  >
                    {review.allIssues.length} issue{review.allIssues.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <h3 className="text-[15px] font-semibold text-foreground">Review &amp; Improve</h3>
              {healthLoading ? (
                <div className="mt-2 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
              ) : review ? (
                <div className="mt-1.5 space-y-1">
                  {review.allIssues.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{review.allIssues.filter(i => i.severity === "critical").length} critical</span>
                      {review.allIssues.filter(i => i.severity === "gap").length > 0 && (
                        <>, {review.allIssues.filter(i => i.severity === "gap").length} gaps</>
                      )}
                      {" "}across {review.structures.filter(s => s.issues.length > 0).length} structure{review.structures.filter(s => s.issues.length > 0).length !== 1 ? "s" : ""}
                    </p>
                  ) : (
                    <p className="text-sm text-success font-medium">No issues found — all clear!</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70">
                    Resolve issues to unlock clean exports.
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Review flagged issues and improve structure quality.
                </p>
              )}
              <Button size="sm" className="mt-4 gap-1.5 text-xs" asChild>
                <span>
                  {review && review.allIssues.length > 0 ? "Fix Issues" : "Review Issues"} <ArrowRight className="h-3 w-3" />
                </span>
              </Button>
            </Link>
          </>
        )}
      </section>

      {/* ── Recent Structures ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Recent Structures</h2>
          {hasStructures && (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" asChild>
              <Link to="/structures">
                View All <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </div>

        {dashboardLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4"
              >
                <div className="flex items-center gap-3.5">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : hasStructures ? (
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
                      {stale && <p className="text-[11px] text-muted-foreground/60 mt-0.5">Not recently updated</p>}
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
            <h3 className="text-lg font-semibold text-foreground">Create your first structure</h3>
            <ul className="mt-6 inline-flex flex-col items-start gap-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <Eye className="h-4 w-4 text-primary/60" /> Visualise ownership clearly
              </li>
              <li className="flex items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-warning/70" /> Spot risks faster
              </li>
              <li className="flex items-center gap-2.5">
                <Share2 className="h-4 w-4 text-primary/60" /> Share with clients easily
              </li>
            </ul>
            {isOwnerOrAdmin && (
              <Button variant="outline" className="mt-10 gap-2 rounded-xl px-6 ml-2" onClick={handleCreateNew}>
                <Plus className="h-4 w-4" />
                Create New Structure
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── Recently Added Entities ── */}
      {recentEntities.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Recently Added</h2>
          <div className="space-y-1.5">
            {recentEntities.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-card px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  {getEntityIcon(e.entity_type)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{e.name}</span>
                      {e.is_trustee_company && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Trustee</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{formatEntityType(e.entity_type)}</span>
                      {e.abn && (
                        <span className="text-[10px] text-muted-foreground/60">ABN {e.abn}</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
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
