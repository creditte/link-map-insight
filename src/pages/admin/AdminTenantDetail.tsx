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

const statusColor: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  invited: "bg-blue-100 text-blue-800",
  disabled: "bg-yellow-100 text-yellow-800",
  deleted: "bg-red-100 text-red-800",
};

export default function AdminTenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("owner");
  const [resending, setResending] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchUsers = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_list_tenant_users_admin", {
      p_tenant_id: tenantId,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setUsers((data as unknown as TenantUser[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, [tenantId]);

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
      fetchUsers();
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
        <h1 className="text-xl font-bold">Tenant Users</h1>
        <span className="text-xs text-muted-foreground">{tenantId}</span>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-4">
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
