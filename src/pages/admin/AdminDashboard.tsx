import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Plus,
  Users,
  Loader2,
  ShieldPlus,
  LogOut,
  Search,
  TrendingUp,
  AlertTriangle,
  Clock,
  LayoutGrid,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface TenantRow {
  id: string;
  name: string;
  firm_name: string;
  created_at: string;
  user_count: number;
  subscription_status: string;
  subscription_plan: string | null;
  access_enabled: boolean | null;
  diagram_count: number | null;
  diagram_limit: number | null;
  cancel_at_period_end: boolean | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  owner_email?: string | null;
}

// DD/MM/YYYY format per project memory
const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const daysUntil = (iso: string | null | undefined) => {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff;
};

type StatusKey = "active" | "trialing" | "lapsed";

const getStatusKey = (status: string): StatusKey => {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  return "lapsed";
};

const statusPillStyles: Record<StatusKey, { dot: string; text: string; bg: string; border: string; label: string }> = {
  active: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-200 dark:border-emerald-500/20",
    label: "Active",
  },
  trialing: {
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-500/10",
    border: "border-sky-200 dark:border-sky-500/20",
    label: "Trialing",
  },
  lapsed: {
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    border: "border-rose-200 dark:border-rose-500/20",
    label: "Lapsed",
  },
};

const planPillStyles: Record<string, { text: string; bg: string; border: string }> = {
  pro: {
    text: "text-purple-700 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-500/10",
    border: "border-purple-200 dark:border-purple-500/20",
  },
  enterprise: {
    text: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    border: "border-amber-200 dark:border-amber-500/20",
  },
  starter: {
    text: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    border: "border-blue-200 dark:border-blue-500/20",
  },
  free: {
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
};

const getInitials = (name: string) => {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
};

const StatusPill = ({ status }: { status: string }) => {
  const key = getStatusKey(status);
  const s = statusPillStyles[key];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

const PlanPill = ({ plan }: { plan: string }) => {
  const key = plan.toLowerCase();
  const s = planPillStyles[key] ?? planPillStyles.free;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium capitalize ${s.bg} ${s.text} ${s.border}`}
    >
      {plan}
    </span>
  );
};

export default function AdminDashboard() {
  const { signOut } = useAuth();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFirmName, setNewFirmName] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recent");

  const [saDialogOpen, setSaDialogOpen] = useState(false);
  const [saEmail, setSaEmail] = useState("");
  const [saPassword, setSaPassword] = useState("");
  const [saDisplayName, setSaDisplayName] = useState("");
  const [saCreating, setSaCreating] = useState(false);

  const { toast } = useToast();

  const fetchTenants = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_list_all_tenants");
    if (error) {
      toast({ title: "Error loading tenants", description: error.message, variant: "destructive" });
    } else {
      setTenants((data as unknown as TenantRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newFirmName.trim()) return;
    setCreating(true);
    const { error } = await supabase.rpc("rpc_create_tenant", {
      p_name: newName.trim(),
      p_firm_name: newFirmName.trim(),
    });
    if (error) {
      toast({ title: "Error creating tenant", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tenant created" });
      setDialogOpen(false);
      setNewName("");
      setNewFirmName("");
      fetchTenants();
    }
    setCreating(false);
  };

  const handleRegisterSuperAdmin = async () => {
    if (!saEmail.trim() || !saPassword.trim()) return;
    setSaCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-super-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        email: saEmail.trim(),
        password: saPassword,
        display_name: saDisplayName.trim() || null,
      }),
    });

    const result = await res.json();
    if (!res.ok || result.error) {
      toast({
        title: "Error registering super admin",
        description: result.error || "Unknown error",
        variant: "destructive",
      });
    } else {
      toast({ title: "Super admin registered", description: `${result.email} can now sign in.` });
      setSaDialogOpen(false);
      setSaEmail("");
      setSaPassword("");
      setSaDisplayName("");
    }
    setSaCreating(false);
  };

  // Stats
  const activeCount = tenants.filter((t) => t.subscription_status === "active").length;
  const trialingTenants = tenants.filter((t) => t.subscription_status === "trialing");
  const trialingCount = trialingTenants.length;
  const lapsedCount = tenants.filter((t) =>
    ["trial_expired", "canceled", "unpaid", "past_due"].includes(t.subscription_status),
  ).length;
  const totalUsers = tenants.reduce((sum, t) => sum + (t.user_count || 0), 0);

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = tenants.filter((t) => new Date(t.created_at).getTime() > oneWeekAgo).length;

  const avgTrialDays = useMemo(() => {
    const days = trialingTenants
      .map((t) => daysUntil(t.trial_ends_at))
      .filter((d): d is number => d !== null && d >= 0);
    if (!days.length) return null;
    return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
  }, [trialingTenants]);

  const subtitle = `${tenants.length} firm${tenants.length === 1 ? "" : "s"} · ${totalUsers} user${totalUsers === 1 ? "" : "s"} · ${activeCount} active subscription${activeCount === 1 ? "" : "s"}`;

  // Filter + sort
  const filteredTenants = useMemo(() => {
    let list = tenants;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.firm_name?.toLowerCase().includes(q) ||
          t.name?.toLowerCase().includes(q) ||
          t.id?.toLowerCase().includes(q) ||
          t.owner_email?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      if (statusFilter === "lapsed") {
        list = list.filter((t) =>
          ["trial_expired", "canceled", "unpaid", "past_due"].includes(t.subscription_status),
        );
      } else {
        list = list.filter((t) => t.subscription_status === statusFilter);
      }
    }
    if (planFilter !== "all") {
      list = list.filter((t) => (t.subscription_plan || "free").toLowerCase() === planFilter);
    }
    const sorted = [...list];
    if (sortBy === "recent") {
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortBy === "name") {
      sorted.sort((a, b) => (a.firm_name || a.name).localeCompare(b.firm_name || b.name));
    } else if (sortBy === "users") {
      sorted.sort((a, b) => (b.user_count || 0) - (a.user_count || 0));
    }
    return sorted;
  }, [tenants, searchQuery, statusFilter, planFilter, sortBy]);

  const statCards = [
    {
      label: "Total Firms",
      value: tenants.length,
      icon: LayoutGrid,
      iconColor: "text-muted-foreground",
      insight: newThisWeek > 0 ? `+${newThisWeek} this week` : "No new firms",
      insightColor: "text-muted-foreground",
    },
    {
      label: "Active",
      value: activeCount,
      icon: TrendingUp,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      insight: activeCount > 0 ? "Paying" : "—",
      insightColor: "text-emerald-700 dark:text-emerald-400",
      showDot: activeCount > 0,
    },
    {
      label: "Trialing",
      value: trialingCount,
      icon: Clock,
      iconColor: "text-sky-600 dark:text-sky-400",
      insight: avgTrialDays !== null ? `${avgTrialDays} days left avg` : "—",
      insightColor: "text-sky-700 dark:text-sky-400",
    },
    {
      label: "Lapsed / Canceled",
      value: lapsedCount,
      icon: AlertTriangle,
      iconColor: lapsedCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
      insight: lapsedCount === 0 ? "No churn" : "Needs attention",
      insightColor: lapsedCount === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight tracking-tight">Super Admin</h1>
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Dialog open={saDialogOpen} onOpenChange={setSaDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ShieldPlus className="h-4 w-4" /> Register Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Register New Super Admin</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={saEmail}
                      onChange={(e) => setSaEmail(e.target.value)}
                      placeholder="admin@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={saPassword}
                      onChange={(e) => setSaPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name (optional)</Label>
                    <Input
                      value={saDisplayName}
                      onChange={(e) => setSaDisplayName(e.target.value)}
                      placeholder="e.g. John Smith"
                    />
                  </div>
                  <Button
                    onClick={handleRegisterSuperAdmin}
                    disabled={saCreating || !saEmail.trim() || saPassword.length < 6}
                    className="w-full"
                  >
                    {saCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Register Super Admin
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" /> New Tenant
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Tenant</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Internal Name</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. acme-corp" />
                  </div>
                  <div className="space-y-2">
                    <Label>Firm Display Name</Label>
                    <Input
                      value={newFirmName}
                      onChange={(e) => setNewFirmName(e.target.value)}
                      placeholder="e.g. ACME Corporation"
                    />
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={creating || !newName.trim() || !newFirmName.trim()}
                    className="w-full"
                  >
                    {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Tenant
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card key={s.label} className="border-border/60 bg-secondary/30 shadow-none">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                  <s.icon className={`h-4 w-4 ${s.iconColor}`} />
                </div>
                <p className="text-2xl font-medium tracking-tight tabular-nums">{loading ? "—" : s.value}</p>
                <div className={`text-xs mt-1.5 flex items-center gap-1.5 ${s.insightColor}`}>
                  {s.showDot && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                  {s.insight}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search firms by name, owner, or ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="trialing">Trialing</SelectItem>
              <SelectItem value="lapsed">Lapsed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="All plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results bar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filteredTenants.length}</span> of {tenants.length}{" "}
            firms
          </p>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[170px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="users">Users</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Firm List */}
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="text-center py-16 border border-dashed rounded-xl">
            <Building2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">
              {tenants.length === 0 ? "No tenants yet" : "No firms match your filters"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {tenants.length === 0
                ? "Create one to get started."
                : "Try clearing your search or filter selection."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredTenants.map((t) => {
              const displayName = t.firm_name || t.name;
              const isTrialing = t.subscription_status === "trialing";
              const trialDaysLeft = isTrialing ? daysUntil(t.trial_ends_at) : null;

              return (
                <Link key={t.id} to={`/admin/tenants/${t.id}`} className="block group">
                  <div className="rounded-xl border border-border/70 bg-card hover:border-primary/40 hover:bg-accent/30 transition-all px-5 py-4 flex items-center gap-4">
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-medium text-primary">
                      {getInitials(displayName)}
                    </div>

                    {/* Firm info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{displayName}</p>
                        <code className="text-[11px] font-mono text-muted-foreground/70 truncate">
                          {t.id.slice(0, 8)}
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {isTrialing && t.trial_ends_at ? (
                          <>
                            Trial ends {formatDate(t.trial_ends_at)}
                            {trialDaysLeft !== null && trialDaysLeft >= 0 && (
                              <> · {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left</>
                            )}
                          </>
                        ) : (
                          <>
                            Created {formatDate(t.created_at)}
                            {t.owner_email && <> · Owner: {t.owner_email}</>}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Pills */}
                    <div className="hidden md:flex items-center gap-1.5 shrink-0">
                      <StatusPill status={t.subscription_status} />
                      {t.subscription_plan && <PlanPill plan={t.subscription_plan} />}
                      {t.cancel_at_period_end && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20">
                          Canceling
                        </span>
                      )}
                    </div>

                    {/* Seat usage */}
                    <div className="hidden sm:block text-right shrink-0 min-w-[72px]">
                      <p className="text-base font-medium tabular-nums leading-none">
                        {t.user_count}
                        <span className="text-muted-foreground font-normal"> / {t.diagram_limit ?? "∞"}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center justify-end gap-1">
                        <Users className="h-3 w-3" /> seats used
                      </p>
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
