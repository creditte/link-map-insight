import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Building2, MessageSquare, Shield, AlertTriangle, Lock, CreditCard } from "lucide-react";
import UsersManagement from "@/components/settings/UsersManagement";
import TenantSettings from "@/components/settings/TenantSettings";
import FeedbackSettings from "@/components/settings/FeedbackSettings";
import MfaSettings from "@/components/settings/MfaSettings";
import BillingSettings from "@/components/settings/BillingSettings";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const { currentUser, loading } = useTenantUsers();

  const role = currentUser?.role ?? null;
  const status = currentUser?.status ?? null;
  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-md" />
          ))}
        </div>
        <div className="space-y-4 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (status === "disabled" || status === "deleted") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
          <h2 className="text-lg font-semibold">Access Removed</h2>
          <p className="text-sm text-muted-foreground">
            Your account access has been removed. Contact your firm administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Tabs defaultValue={isOwnerOrAdmin ? "users" : "security"}>
        <TabsList>
          {isOwnerOrAdmin && (
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Users
            </TabsTrigger>
          )}
          <TabsTrigger value="firm" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Firm
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Security
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="billing" className="gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Billing
            </TabsTrigger>
          )}
          {isOwnerOrAdmin && (
            <TabsTrigger value="feedback" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Feedback
            </TabsTrigger>
          )}
        </TabsList>

        {isOwnerOrAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersManagement />
          </TabsContent>
        )}

        <TabsContent value="firm" className="mt-4">
          <TenantSettings isAdmin={isOwnerOrAdmin} />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <MfaSettings />
        </TabsContent>

        {isOwner && (
          <TabsContent value="billing" className="mt-4">
            <BillingSettings />
          </TabsContent>
        )}

        {isOwnerOrAdmin && (
          <TabsContent value="feedback" className="mt-4">
            <FeedbackSettings />
          </TabsContent>
        )}
      </Tabs>

      {!isOwnerOrAdmin && (
        <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 shrink-0" />
          User and firm management is only available to owners and administrators.
        </div>
      )}
    </div>
  );
}
