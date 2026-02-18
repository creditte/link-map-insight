import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantUsers, type TenantUser } from "@/hooks/useTenantUsers";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
  Mail, Shield, ShieldCheck, Crown, Trash2, RotateCcw, Info,
} from "lucide-react";
import { format } from "date-fns";

// ── standalone badge components (defined outside to avoid hooks issues) ──
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge variant="default" className="gap-1 text-[10px] font-medium"><CheckCircle className="h-2.5 w-2.5" /> Active</Badge>;
    case "invited":
      return <Badge variant="secondary" className="gap-1 text-[10px] font-medium"><Mail className="h-2.5 w-2.5" /> Invited</Badge>;
    case "disabled":
      return <Badge variant="destructive" className="gap-1 text-[10px] font-medium"><Ban className="h-2.5 w-2.5" /> Disabled</Badge>;
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
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => toggleFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
              statusFilters.has(f)
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            {f}
          </button>
        ))}
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading users...
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
                    <TableCell><RoleBadge role={u.role} /></TableCell>
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
    </div>
  );
}
