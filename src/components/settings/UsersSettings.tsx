import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  MoreHorizontal,
  Shield,
  ShieldCheck,
  Ban,
  CheckCircle,
  RefreshCw,
  Loader2,
  Mail,
} from "lucide-react";

interface UserRow {
  user_id: string;
  full_name: string | null;
  status: string;
  created_at: string;
  last_sign_in_at: string | null;
  email?: string;
  role?: string;
}

export default function UsersSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Invite dialog
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("user");
  const [inviting, setInviting] = useState(false);

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);

    // Get tenant_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id ?? "")
      .single();

    if (!profile) {
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);

    // Get all profiles in tenant (admin policy allows this)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, status, created_at, last_sign_in_at")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true });

    if (!profiles) {
      setLoading(false);
      return;
    }

    // Get roles for these users
    const userIds = profiles.map((p) => p.user_id);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role]));

    // We can't query auth.users directly, so we'll use the profile data
    // For email, we know the current user's email from auth
    const enriched: UserRow[] = profiles.map((p) => ({
      ...p,
      role: roleMap.get(p.user_id) ?? "user",
      email: p.user_id === user?.id ? user?.email ?? "" : undefined,
    }));

    setUsers(enriched);
    setLoading(false);
  }, [user?.id, user?.email]);

  useEffect(() => {
    if (user?.id) loadUsers();
  }, [user?.id, loadUsers]);

  const callEdgeFunction = async (body: Record<string, unknown>) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Request failed");
    return result;
  };

  const handleInvite = async () => {
    if (!inviteEmail || !tenantId) return;
    setInviting(true);

    try {
      await callEdgeFunction({
        action: "invite",
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        tenant_id: tenantId,
        full_name: inviteName.trim(),
      });

      toast({
        title: "Invitation sent",
        description: `Invite email sent to ${inviteEmail}`,
      });
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("user");
      loadUsers();
    } catch (err: any) {
      toast({
        title: "Invite failed",
        description: err.message,
        variant: "destructive",
      });
    }

    setInviting(false);
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    setActionLoading(userId);
    try {
      await callEdgeFunction({
        action: "change_role",
        user_id: userId,
        new_role: newRole,
      });
      toast({ title: "Role updated" });
      loadUsers();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleToggleStatus = async (userId: string, newStatus: string) => {
    setActionLoading(userId);
    try {
      await callEdgeFunction({
        action: "toggle_status",
        user_id: userId,
        new_status: newStatus,
      });
      toast({
        title: newStatus === "disabled" ? "User disabled" : "User re-enabled",
      });
      loadUsers();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleResendInvite = async (email: string) => {
    setActionLoading(email);
    try {
      await callEdgeFunction({
        action: "resend_invite",
        email,
      });
      toast({ title: "Invite resent", description: `Re-sent to ${email}` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge variant="default" className="gap-1 text-[10px]">
            <CheckCircle className="h-3 w-3" /> Active
          </Badge>
        );
      case "invited":
        return (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Mail className="h-3 w-3" /> Invited
          </Badge>
        );
      case "disabled":
        return (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <Ban className="h-3 w-3" /> Disabled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    if (role === "admin") {
      return (
        <Badge variant="outline" className="gap-1 text-[10px] border-primary text-primary">
          <ShieldCheck className="h-3 w-3" /> Admin
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Shield className="h-3 w-3" /> User
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage team members and their access levels.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setShowInvite(true)}>
          <UserPlus className="h-4 w-4" /> Invite User
        </Button>
      </div>

      {loading ? (
        <Card>
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">
                        {u.full_name || "—"}
                        {u.user_id === user?.id && (
                          <span className="text-muted-foreground text-xs ml-1">(you)</span>
                        )}
                      </p>
                      {u.email && (
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getRoleBadge(u.role ?? "user")}</TableCell>
                  <TableCell>{getStatusBadge(u.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {u.user_id !== user?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={actionLoading === u.user_id}
                          >
                            {actionLoading === u.user_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {u.role === "user" ? (
                            <DropdownMenuItem
                              onClick={() => handleChangeRole(u.user_id, "admin")}
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" /> Make Admin
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleChangeRole(u.user_id, "user")}
                            >
                              <Shield className="h-4 w-4 mr-2" /> Make User
                            </DropdownMenuItem>
                          )}
                          {u.status === "active" ? (
                            <DropdownMenuItem
                              onClick={() =>
                                handleToggleStatus(u.user_id, "disabled")
                              }
                              className="text-destructive"
                            >
                              <Ban className="h-4 w-4 mr-2" /> Disable
                            </DropdownMenuItem>
                          ) : u.status === "disabled" ? (
                            <DropdownMenuItem
                              onClick={() =>
                                handleToggleStatus(u.user_id, "active")
                              }
                            >
                              <CheckCircle className="h-4 w-4 mr-2" /> Re-enable
                            </DropdownMenuItem>
                          ) : null}
                          {u.status === "invited" && u.email && (
                            <DropdownMenuItem
                              onClick={() => handleResendInvite(u.email!)}
                            >
                              <RefreshCw className="h-4 w-4 mr-2" /> Resend Invite
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an email invitation. The user will set their password and join
              your team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Email</Label>
              <Input
                type="email"
                placeholder="colleague@creditte.com.au"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Full Name (optional)</Label>
              <Input
                placeholder="Jane Smith"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInvite(false)}
              disabled={inviting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail}
            >
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" /> Sending...
                </>
              ) : (
                "Send Invitation"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
