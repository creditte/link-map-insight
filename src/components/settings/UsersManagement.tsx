import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantUsers, type TenantUser } from "@/hooks/useTenantUsers";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UserPlus, MoreHorizontal, Ban, CheckCircle, RefreshCw, Loader2,
  Mail, Shield, ShieldCheck, Crown, Trash2, RotateCcw, Info, Link2, CreditCard,
} from "lucide-react";
import { format } from "date-fns";

// ── standalone badge components (defined outside to avoid hooks issues) ──
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge className="gap-1 text-[10px] font-medium bg-primary text-primary-foreground border-transparent"><CheckCircle className="h-2.5 w-2.5" /> Active</Badge>;
    case "invited":
      return <Badge className="gap-1 text-[10px] font-medium bg-muted text-muted-foreground border-transparent">Invited</Badge>;
    case "disabled":
      return <Badge className="gap-1 text-[10px] font-medium bg-destructive text-destructive-foreground border-transparent">Disabled</Badge>;
    case "deleted":
      return <Badge variant="outline" className="gap-1 text-[10px] font-medium text-muted-foreground"><Trash2 className="h-2.5 w-2.5" /> Deleted</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function RoleBadge({ role }: { role: string }) {
  if (role === "owner")
    return <Badge variant="secondary" className="gap-1 text-[10px] font-medium"><Crown className="h-2.5 w-2.5" /> Owner</Badge>;
  if (role === "admin")
    return <Badge variant="outline" className="gap-1 text-[10px] border-primary/60 text-primary"><ShieldCheck className="h-2.5 w-2.5" /> Admin</Badge>;
  return <Badge variant="outline" className="gap-1 text-[10px]"><Shield className="h-2.5 w-2.5" /> User</Badge>;
}

type StatusFilter = "active" | "invited" | "disabled";

const STATUS_FILTERS: StatusFilter[] = ["active", "invited", "disabled"];

export default function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { users, currentUser, tenantId, loading, callAction, actionLoading } = useTenantUsers();

  const myRole = currentUser?.role ?? "user";
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  // Filters
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(
    new Set(["active", "invited", "disabled"])
  );
  const [showDeleted, setShowDeleted] = useState(false);

  // Invite dialog
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "user">("user");
  const [inviting, setInviting] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<TenantUser | null>(null);

  // Change role dialog
  const [roleTarget, setRoleTarget] = useState<TenantUser | null>(null);
  const [roleValue, setRoleValue] = useState<"owner" | "admin" | "user">("user");

  // Permission grant dialogs
  const [grantIntegrationTarget, setGrantIntegrationTarget] = useState<TenantUser | null>(null);
  const [grantBillingTarget, setGrantBillingTarget] = useState<TenantUser | null>(null);
  const [conflictDialog, setConflictDialog] = useState<{ type: "integration" | "billing"; holderName: string } | null>(null);

  // ── derived ──────────────────────────────────────────────────────
  const activeOwnerCount = users.filter(
    (u) => u.role === "owner" && u.status === "active"
  ).length;

  const filteredUsers = users.filter((u) => {
    if (u.status === "deleted") return showDeleted && isOwnerOrAdmin;
    return statusFilters.has(u.status as StatusFilter);
  });

  // ── helpers ───────────────────────────────────────────────────────
  const isLastOwner = (u: TenantUser) =>
    u.role === "owner" && activeOwnerCount <= 1;

  const isSelf = (u: TenantUser) => u.auth_user_id === user?.id;

  const canDisable = (u: TenantUser) =>
    isOwnerOrAdmin && u.status === "active" && !isLastOwner(u);

  const canEnable = (u: TenantUser) =>
    isOwnerOrAdmin && u.status === "disabled";

  const canReinvite = (u: TenantUser) =>
    isOwnerOrAdmin && ["invited", "disabled"].includes(u.status);

  const canDelete = (u: TenantUser) =>
    isOwner && u.status !== "deleted" && !isLastOwner(u) && !isSelf(u);

  const canRestore = (u: TenantUser) =>
    isOwnerOrAdmin && u.status === "deleted";

  const canChangeRole = (u: TenantUser) =>
    isOwnerOrAdmin && u.status !== "deleted";

  // ── action handlers ───────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      await callAction("invite", {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        display_name: inviteName.trim() || null,
      });
      toast({ title: "Invitation sent", description: `Invite email sent to ${inviteEmail}` });
      setShowInvite(false);
      setInviteEmail(""); setInviteName(""); setInviteRole("user");
    } catch (e: any) {
      toast({ title: "Invite failed", description: e.message, variant: "destructive" });
    }
    setInviting(false);
  };

  const act = async (action: string, u: TenantUser, successMsg: string) => {
    try {
      await callAction(action, { tenant_user_id: u.id });
      toast({ title: successMsg });
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    }
  };

  const handleChangeRole = async () => {
    if (!roleTarget) return;
    try {
      await callAction("change_role", { tenant_user_id: roleTarget.id, new_role: roleValue });
      toast({ title: "Role updated" });
      setRoleTarget(null);
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  // ── badges ────────────────────────────────────────────────────────
  const toggleFilter = (f: StatusFilter) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) { next.delete(f); } else { next.add(f); }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage team members and their access.
          </p>
        </div>
        {isOwnerOrAdmin && (
          <Button className="gap-1.5" onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4" /> Invite User
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const count = users.filter((u) => u.status === f).length;
          return (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                statusFilters.has(f)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              }`}
            >
              {f} ({count})
            </button>
          );
        })}
        {isOwnerOrAdmin && (
          <label className="ml-2 flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
            <Switch
              checked={showDeleted}
              onCheckedChange={setShowDeleted}
              className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
            />
            Show deleted
          </label>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3 py-4">
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
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last invited</TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">
                    No users match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {filteredUsers.map((u) => {
                const isLoading = actionLoading === u.id;
                const selfRow = isSelf(u);
                const lastOwner = isLastOwner(u);

                return (
                  <TableRow key={u.id} className={u.status === "deleted" ? "opacity-60" : ""}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">
                          {u.display_name || u.email}
                          {selfRow && (
                            <span className="ml-1.5 text-muted-foreground text-xs">(you)</span>
                          )}
                        </p>
                        {u.display_name && (
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <RoleBadge role={u.role} />
                        {u.role === "admin" && u.can_manage_integrations && (
                          <Badge variant="outline" className="gap-1 text-[10px] border-green-500/60 text-green-600">
                            <Link2 className="h-2.5 w-2.5" /> Integrations
                          </Badge>
                        )}
                        {u.role === "admin" && u.can_manage_billing && (
                          <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/60 text-amber-600">
                            <CreditCard className="h-2.5 w-2.5" /> Billing
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={u.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_invited_at
                        ? format(new Date(u.last_invited_at), "d MMM yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {isLoading ? (
                        <div className="flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {/* Reinvite */}
                            {canReinvite(u) && (
                              <DropdownMenuItem onClick={() => act("reinvite", u, "Invite resent")}>
                                <RefreshCw className="h-4 w-4 mr-2" /> Reinvite
                              </DropdownMenuItem>
                            )}

                            {/* Enable */}
                            {canEnable(u) && (
                              <DropdownMenuItem onClick={() => act("enable", u, "User enabled")}>
                                <CheckCircle className="h-4 w-4 mr-2" /> Enable
                              </DropdownMenuItem>
                            )}

                            {/* Disable */}
                            {u.status === "active" && isOwnerOrAdmin && (
                              lastOwner ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="relative flex cursor-not-allowed items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground select-none">
                                      <Ban className="h-4 w-4 mr-2" /> Disable
                                      <Info className="h-3 w-3 ml-auto" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>Cannot disable the last owner</TooltipContent>
                                </Tooltip>
                              ) : (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => act("disable", u, "User disabled")}
                                >
                                  <Ban className="h-4 w-4 mr-2" /> Disable
                                </DropdownMenuItem>
                              )
                            )}

                            {/* Change role */}
                            {canChangeRole(u) && !selfRow && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => { setRoleTarget(u); setRoleValue(u.role); }}>
                                  <Shield className="h-4 w-4 mr-2" /> Change role
                                </DropdownMenuItem>
                              </>
                            )}

                            {/* Grant / Revoke Integration Access (admin only, owner action) */}
                            {isOwner && u.role === "admin" && u.status !== "deleted" && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  if (u.can_manage_integrations) {
                                    // Revoke immediately
                                    try {
                                      await callAction("toggle_integrations", { tenant_user_id: u.id, grant: false });
                                      toast({ title: "Integration access revoked" });
                                    } catch (e: any) {
                                      toast({ title: "Failed", description: e.message, variant: "destructive" });
                                    }
                                  } else {
                                    // Pre-check: does another admin already hold this?
                                    const existingHolder = users.find(x => x.can_manage_integrations && x.id !== u.id && x.status === "active");
                                    if (existingHolder) {
                                      setConflictDialog({ type: "integration", holderName: existingHolder.display_name || existingHolder.email });
                                    } else {
                                      setGrantIntegrationTarget(u);
                                    }
                                  }
                                }}
                              >
                                <Link2 className="h-4 w-4 mr-2" />
                                {u.can_manage_integrations ? "Revoke Integration Access" : "Grant Integration Access"}
                              </DropdownMenuItem>
                            )}

                            {/* Grant / Revoke Billing Access (admin only, owner action) */}
                            {isOwner && u.role === "admin" && u.status !== "deleted" && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  if (u.can_manage_billing) {
                                    // Revoke immediately
                                    try {
                                      await callAction("toggle_billing", { tenant_user_id: u.id, grant: false });
                                      toast({ title: "Billing access revoked" });
                                    } catch (e: any) {
                                      toast({ title: "Failed", description: e.message, variant: "destructive" });
                                    }
                                  } else {
                                    // Pre-check: does another admin already hold this?
                                    const existingBillHolder = users.find(x => x.can_manage_billing && x.id !== u.id && x.status === "active");
                                    if (existingBillHolder) {
                                      setConflictDialog({ type: "billing", holderName: existingBillHolder.display_name || existingBillHolder.email });
                                    } else {
                                      setGrantBillingTarget(u);
                                    }
                                  }
                                }}
                              >
                                <CreditCard className="h-4 w-4 mr-2" />
                                {u.can_manage_billing ? "Revoke Billing Access" : "Grant Billing Access"}
                              </DropdownMenuItem>
                            )}

                            {/* Restore */}
                            {canRestore(u) && (
                              <DropdownMenuItem onClick={() => act("restore", u, "User restored and invite sent")}>
                                <RotateCcw className="h-4 w-4 mr-2" /> Restore
                              </DropdownMenuItem>
                            )}

                            {/* Delete */}
                            {canDelete(u) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteTarget(u)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}

                            {/* Self-delete blocked */}
                            {isOwner && selfRow && u.status !== "deleted" && (
                              <>
                                <DropdownMenuSeparator />
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="relative flex cursor-not-allowed items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground select-none">
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                                      <Info className="h-3 w-3 ml-auto" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>Transfer ownership first</TooltipContent>
                                </Tooltip>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              They'll receive a magic link to access the workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-sm">Email</Label>
              <Input
                type="email"
                placeholder="colleague@firm.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Display name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                placeholder="Jane Smith"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as any)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User — read/edit structures</SelectItem>
                  <SelectItem value="admin">Admin — user management + settings</SelectItem>
                  {isOwner && (
                    <SelectItem value="owner">Owner — full access</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Sending…</> : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user access?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <strong>{deleteTarget?.display_name || deleteTarget?.email}</strong> will lose all access immediately. Their history and audit records are preserved.
              </span>
              <span className="block text-destructive font-medium text-sm">
                This cannot be undone without restoring the user.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return;
                await act("soft_delete", deleteTarget, "User removed");
                setDeleteTarget(null);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change role dialog */}
      <Dialog open={!!roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              Update role for <strong>{roleTarget?.display_name || roleTarget?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={roleValue} onValueChange={(v) => setRoleValue(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                {isOwner && <SelectItem value="owner">Owner</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>Cancel</Button>
            <Button onClick={handleChangeRole}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Integration Access warning dialog */}
      <AlertDialog open={!!grantIntegrationTarget} onOpenChange={(o) => !o && setGrantIntegrationTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant integration access</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                You are about to give this person full access to connect and manage third-party integrations for your firm, including XPM and any other connected platforms. This means they will be able to link accounts, configure sync settings, and manage data flowing between strukcha and your external tools.
              </span>
              <span className="block font-medium">
                Only grant this to someone you fully trust with your firm's integration settings.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!grantIntegrationTarget) return;
                try {
                  await callAction("toggle_integrations", { tenant_user_id: grantIntegrationTarget.id, grant: true });
                  toast({ title: "Integration access granted" });
                } catch (e: any) {
                  if (e.message?.includes("integration_already_granted")) {
                    const holder = users.find(x => x.can_manage_integrations && x.id !== grantIntegrationTarget.id);
                    setConflictDialog({ type: "integration", holderName: holder?.display_name || holder?.email || "another admin" });
                  } else {
                    toast({ title: "Failed", description: e.message, variant: "destructive" });
                  }
                }
                setGrantIntegrationTarget(null);
              }}
            >
              Yes, grant access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Grant Billing Access warning dialog */}
      <AlertDialog open={!!grantBillingTarget} onOpenChange={(o) => !o && setGrantBillingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant plan & billing access</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                You are about to give this person the ability to manage your strukcha subscription on your behalf. This includes upgrading or downgrading your plan, updating payment details, and cancelling your subscription entirely.
              </span>
              <span className="block">
                This action cannot be undone by the admin themselves. Only you as the account owner can revoke this permission.
              </span>
              <span className="block font-medium">
                Only grant this to someone you fully trust with your firm's billing and subscription decisions.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={async () => {
                if (!grantBillingTarget) return;
                try {
                  await callAction("toggle_billing", { tenant_user_id: grantBillingTarget.id, grant: true });
                  toast({ title: "Billing access granted" });
                } catch (e: any) {
                  if (e.message?.includes("billing_already_granted")) {
                    const holder = users.find(u => u.can_manage_billing && u.id !== grantBillingTarget.id);
                    setConflictDialog({ type: "billing", holderName: holder?.display_name || holder?.email || "another admin" });
                  } else {
                    toast({ title: "Failed", description: e.message, variant: "destructive" });
                  }
                }
                setGrantBillingTarget(null);
              }}
            >
              Yes, grant access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conflict dialog — permission already granted to someone else */}
      <AlertDialog open={!!conflictDialog} onOpenChange={(o) => !o && setConflictDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflictDialog?.type === "integration" ? "Integration access already granted" : "Billing access already granted"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                You have already granted {conflictDialog?.type === "integration" ? "integration" : "plan & billing"} access to <strong>{conflictDialog?.holderName}</strong>. For security reasons, only one person can hold this permission at a time.
              </span>
              <span className="block">
                To give this person {conflictDialog?.type === "integration" ? "integration" : "billing"} access, you must first remove it from <strong>{conflictDialog?.holderName}</strong>.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setConflictDialog(null)}>
              OK, got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
