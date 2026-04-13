import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, UserPlus, MailCheck, CreditCard, Shield, BarChart3 } from "lucide-react";

interface TenantUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
}

interface TenantInfo {
  subscription_status: string;
  subscription_plan: string | null;
  access_enabled: boolean | null;
  access_locked_reason: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  diagram_count: number | null;
  diagram_limit: number | null;
  cancel_at_period_end: boolean | null;
  firm_name: string;
  stripe_customer_id: string | null;
}

const statusColor: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  invited: "bg-sky-50 text-sky-700 border-sky-200",
  disabled: "bg-amber-50 text-amber-700 border-amber-200",
  deleted: "bg-rose-50 text-rose-700 border-rose-200",
};

const subStatusColor: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trialing: "bg-sky-50 text-sky-700 border-sky-200",
  trial_expired: "bg-amber-50 text-amber-700 border-amber-200",
  past_due: "bg-yellow-50 text-yellow-700 border-yellow-200",
  canceled: "bg-rose-50 text-rose-700 border-rose-200",
  unpaid: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function AdminTenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("owner");
  const [resending, setResending] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = async () => {
    if (!tenantId) return;
    setLoading(true);

    const [usersRes, tenantRes] = await Promise.all([
      supabase.rpc("rpc_list_tenant_users_admin", { p_tenant_id: tenantId }),
      supabase
        .from("tenants")
        .select("firm_name, subscription_status, subscription_plan, access_enabled, access_locked_reason, trial_ends_at, current_period_end, diagram_count, diagram_limit, cancel_at_period_end, stripe_customer_id")
        .eq("id", tenantId)
        .single(),
    ]);

    if (usersRes.error) {
      toast({ title: "Error", description: usersRes.error.message, variant: "destructive" });
    } else {
      setUsers((usersRes.data as unknown as TenantUser[]) ?? []);
    }

    if (tenantRes.data) {
      setTenant(tenantRes.data as TenantInfo);
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const callAdminInvite = async (inviteEmail: string, inviteDisplayName?: string | null, inviteRole?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          email: inviteEmail,
          tenant_id: tenantId,
          display_name: inviteDisplayName || null,
          role: inviteRole || "owner",
        }),
      }
    );
    return res.json();
  };

  const handleAddUser = async () => {
    if (!tenantId || !email.trim()) return;
    setCreating(true);
    const result = await callAdminInvite(email.trim(), displayName.trim() || null, role);
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "User invited", description: result.message || "Invitation email sent" });
      setDialogOpen(false);
      setEmail("");
      setDisplayName("");
      setRole("owner");
      fetchData();
    }
    setCreating(false);
  };

  const handleResendInvite = async (u: TenantUser) => {
    setResending(u.id);
    const result = await callAdminInvite(u.email, u.display_name, u.role);
    if (result.error) {
      toast({ title: "Error resending", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Invite resent", description: `Email sent to ${u.email}` });
    }
    setResending(null);
  };

  const usagePercent = tenant?.diagram_limit
    ? Math.min(100, Math.round(((tenant.diagram_count ?? 0) / tenant.diagram_limit) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur-md px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link to="/admin">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight truncate">{tenant?.firm_name || "Tenant Details"}</h1>
            <p className="text-xs text-muted-foreground font-mono truncate">{tenantId}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Subscription & Billing */}
        {tenant && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Status Card */}
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subscription</p>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-xs font-medium ${subStatusColor[tenant.subscription_status] ?? "bg-muted text-muted-foreground"}`}>
                    {tenant.subscription_status.replace(/_/g, " ")}
                  </Badge>
                  {tenant.cancel_at_period_end && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Canceling
                    </Badge>
                  )}
                </div>
                <p className="text-sm capitalize font-medium">{tenant.subscription_plan || "No plan"}</p>
                {tenant.trial_ends_at && tenant.subscription_status === "trialing" && (
                  <p className="text-xs text-muted-foreground mt-1">Trial ends {new Date(tenant.trial_ends_at).toLocaleDateString()}</p>
                )}
                {tenant.current_period_end && tenant.subscription_status === "active" && (
                  <p className="text-xs text-muted-foreground mt-1">Renews {new Date(tenant.current_period_end).toLocaleDateString()}</p>
                )}
              </CardContent>
            </Card>

            {/* Access Card */}
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Access</p>
                </div>
                <p className={`text-sm font-semibold ${tenant.access_enabled ? "text-emerald-700" : "text-rose-700"}`}>
                  {tenant.access_enabled ? "Enabled" : "Locked"}
                </p>
                {!tenant.access_enabled && tenant.access_locked_reason && (
                  <p className="text-xs text-muted-foreground mt-1">{tenant.access_locked_reason.replace(/_/g, " ")}</p>
                )}
              </CardContent>
            </Card>

            {/* Usage Card */}
            <Card>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Structures</p>
                </div>
                <p className="text-sm font-semibold">{tenant.diagram_count ?? 0} / {tenant.diagram_limit ?? "∞"}</p>
                {tenant.diagram_limit && (
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${usagePercent >= 90 ? "bg-rose-500" : usagePercent >= 70 ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Users Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Team Members ({users.length})</h2>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <UserPlus className="h-4 w-4" /> Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite User to Tenant</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" type="email" />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name (optional)</Label>
                    <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAddUser} disabled={creating || !email.trim()} className="w-full">
                    {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Send Invitation
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-sm text-muted-foreground">No users yet. Add a user to get this tenant started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <Card key={u.id} className="group">
                  <CardContent className="py-3 px-5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/5 flex items-center justify-center shrink-0 text-sm font-semibold text-primary/60 uppercase">
                        {(u.display_name || u.email).charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.display_name || u.email}</p>
                        {u.display_name && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">{u.role}</Badge>
                      <Badge variant="outline" className={`text-xs capitalize ${statusColor[u.status] ?? ""}`}>{u.status}</Badge>
                      {u.status === "invited" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          disabled={resending === u.id}
                          onClick={() => handleResendInvite(u)}
                        >
                          {resending === u.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <MailCheck className="h-3 w-3" />
                          )}
                          Resend
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
