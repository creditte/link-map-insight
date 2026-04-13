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
import { ArrowLeft, Loader2, UserPlus, MailCheck } from "lucide-react";

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
  active: "bg-green-100 text-green-800",
  invited: "bg-blue-100 text-blue-800",
  disabled: "bg-yellow-100 text-yellow-800",
  deleted: "bg-red-100 text-red-800",
};

const subStatusColor: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  trialing: "bg-blue-100 text-blue-800 border-blue-200",
  trial_expired: "bg-orange-100 text-orange-800 border-orange-200",
  past_due: "bg-yellow-100 text-yellow-800 border-yellow-200",
  canceled: "bg-red-100 text-red-800 border-red-200",
  unpaid: "bg-red-100 text-red-800 border-red-200",
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center gap-4">
        <Link to="/admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">{tenant?.firm_name || "Tenant Details"}</h1>
          <span className="text-xs text-muted-foreground">{tenantId}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Subscription Overview */}
        {tenant && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Subscription & Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  <Badge variant="outline" className={`text-xs ${subStatusColor[tenant.subscription_status] ?? "bg-gray-100 text-gray-800"}`}>
                    {tenant.subscription_status.replace(/_/g, " ")}
                  </Badge>
                  {tenant.cancel_at_period_end && (
                    <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 ml-1">
                      Canceling
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Plan</p>
                  <p className="font-medium capitalize">{tenant.subscription_plan || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Access</p>
                  <p className="font-medium">
                    {tenant.access_enabled ? (
                      <span className="text-green-700">Enabled</span>
                    ) : (
                      <span className="text-red-700">Locked{tenant.access_locked_reason ? ` (${tenant.access_locked_reason.replace(/_/g, " ")})` : ""}</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Structures</p>
                  <p className="font-medium">{tenant.diagram_count ?? 0} / {tenant.diagram_limit ?? "∞"}</p>
                </div>
                {tenant.trial_ends_at && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Trial Ends</p>
                    <p className="font-medium">{new Date(tenant.trial_ends_at).toLocaleDateString()}</p>
                  </div>
                )}
                {tenant.current_period_end && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Period Ends</p>
                    <p className="font-medium">{new Date(tenant.current_period_end).toLocaleDateString()}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Users Section */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Users ({users.length})</h2>
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
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">No users yet. Add a user to get this tenant started.</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <Card key={u.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{u.display_name || u.email}</p>
                    {u.display_name && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{u.role}</Badge>
                    <Badge className={`text-xs ${statusColor[u.status] ?? ""}`}>{u.status}</Badge>
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
      </main>
    </div>
  );
}
