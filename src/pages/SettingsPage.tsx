import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Building2, Shield, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import UsersSettings from "@/components/settings/UsersSettings";
import TenantSettings from "@/components/settings/TenantSettings";
import FeedbackSettings from "@/components/settings/FeedbackSettings";

export default function SettingsPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "admin" })
      .then(({ data }) => {
        setIsAdmin(!!data);
        setLoading(false);
      });
  }, [user?.id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Tabs defaultValue={isAdmin ? "users" : "tenant"}>
        <TabsList>
          {isAdmin && (
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Users
            </TabsTrigger>
          )}
          <TabsTrigger value="tenant" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Organisation
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="feedback" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Feedback
            </TabsTrigger>
          )}
        </TabsList>

        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersSettings />
          </TabsContent>
        )}

        <TabsContent value="tenant" className="mt-4">
          <TenantSettings />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="feedback" className="mt-4">
            <FeedbackSettings />
          </TabsContent>
        )}
      </Tabs>

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 shrink-0" />
          User management is only available to administrators.
        </div>
      )}
    </div>
  );
}
