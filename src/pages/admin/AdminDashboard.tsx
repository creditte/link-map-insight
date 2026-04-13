import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Users, Loader2, ShieldPlus, LogOut, Search, TrendingUp, AlertTriangle, Clock, LayoutGrid } from "lucide-react";
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
}

const statusBadgeVariant = (status: string): { label: string; className: string } => {
  switch (status) {
    case "active":
      return { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "trialing":
      return { label: "Trialing", className: "bg-sky-50 text-sky-700 border-sky-200" };
    case "trial_expired":
      return { label: "Trial Expired", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "past_due":
      return { label: "Past Due", className: "bg-yellow-50 text-yellow-700 border-yellow-200" };
    case "canceled":
      return { label: "Canceled", className: "bg-rose-50 text-rose-700 border-rose-200" };
    case "unpaid":
      return { label: "Unpaid", className: "bg-rose-50 text-rose-700 border-rose-200" };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
  }
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

  useEffect(() => { fetchTenants(); }, []);

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

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-super-admin`,
      {
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
      }
    );

    const result = await res.json();
    if (!res.ok || result.error) {
      toast({ title: "Error registering super admin", description: result.error || "Unknown error", variant: "destructive" });
    } else {
      toast({ title: "Super admin registered", description: `${result.email} can now sign in.` });
      setSaDialogOpen(false);
      setSaEmail("");
      setSaPassword("");
      setSaDisplayName("");
    }
    setSaCreating(false);
  };

  const activeCount = tenants.filter(t => t.subscription_status === "active").length;
  const trialingCount = tenants.filter(t => t.subscription_status === "trialing").length;
  const lapsedCount = tenants.filter(t => ["trial_expired", "canceled", "unpaid", "past_due"].includes(t.subscription_status)).length;
  const totalUsers = tenants.reduce((sum, t) => sum + (t.user_count || 0), 0);

  const filteredTenants = useMemo(() => {
    if (!searchQuery.trim()) return tenants;
    const q = searchQuery.toLowerCase();
    return tenants.filter(t =>
      t.firm_name?.toLowerCase().includes(q) ||
      t.name?.toLowerCase().includes(q) ||
      t.subscription_status?.toLowerCase().includes(q) ||
      t.subscription_plan?.toLowerCase().includes(q)
    );
  }, [tenants, searchQuery]);

  const statCards = [
    { label: "Total Firms", value: tenants.length, icon: LayoutGrid, color: "text-primary" },
    { label: "Active", value: activeCount, icon: TrendingUp, color: "text-emerald-600" },
    { label: "Trialing", value: trialingCount, icon: Clock, color: "text-sky-600" },
    { label: "Lapsed / Canceled", value: lapsedCount, icon: AlertTriangle, color: "text-rose-600" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur-md px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Super Admin</h1>
              <p className="text-xs text-muted-foreground">{tenants.length} firms · {totalUsers} users</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                    <Input type="email" value={saEmail} onChange={(e) => setSaEmail(e.target.value)} placeholder="admin@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input type="password" value={saPassword} onChange={(e) => setSaPassword(e.target.value)} placeholder="Minimum 6 characters" />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name (optional)</Label>
                    <Input value={saDisplayName} onChange={(e) => setSaDisplayName(e.target.value)} placeholder="e.g. John Smith" />
                  </div>
                  <Button onClick={handleRegisterSuperAdmin} disabled={saCreating || !saEmail.trim() || saPassword.length < 6} className="w-full">
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
                    <Input value={newFirmName} onChange={(e) => setNewFirmName(e.target.value)} placeholder="e.g. ACME Corporation" />
                  </div>
                  <Button onClick={handleCreate} disabled={creating || !newName.trim() || !newFirmName.trim()} className="w-full">
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
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card key={s.label} className="relative overflow-hidden">
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <s.icon className={`h-5 w-5 ${s.color} opacity-80`} />
                </div>
                <p className="text-3xl font-bold tracking-tight">{loading ? "—" : s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + Tenant List */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search firms…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {filteredTenants.length} of {tenants.length} firms
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-lg" />
              ))}
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                {tenants.length === 0 ? "No tenants yet. Create one to get started." : "No firms match your search."}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              {filteredTenants.map((t) => {
                const badge = statusBadgeVariant(t.subscription_status);
                return (
                  <Link key={t.id} to={`/admin/tenants/${t.id}`}>
                    <Card className="hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
                      <CardContent className="py-4 px-5 flex items-center justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                            <Building2 className="h-4 w-4 text-primary/60" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{t.firm_name || t.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(t.created_at).toLocaleDateString()}
                              {t.subscription_status === "trialing" && t.trial_ends_at && (
                                <> · Trial ends {new Date(t.trial_ends_at).toLocaleDateString()}</>
                              )}
                              {t.current_period_end && t.subscription_status === "active" && (
                                <> · Renews {new Date(t.current_period_end).toLocaleDateString()}</>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <Badge variant="outline" className={`text-xs font-medium ${badge.className}`}>
                            {badge.label}
                          </Badge>
                          {t.subscription_plan && t.subscription_status === "active" && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {t.subscription_plan}
                            </Badge>
                          )}
                          {t.cancel_at_period_end && (
                            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                              Canceling
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {t.diagram_count ?? 0}/{t.diagram_limit ?? "∞"}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" /> {t.user_count}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
