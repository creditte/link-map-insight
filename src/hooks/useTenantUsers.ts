import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { qk, staleTimes } from "@/lib/queryKeys";
import { useMyTenantUserQuery } from "@/hooks/useSharedQueries";

export interface TenantUser {
  id: string;
  tenant_id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string | null;
  role: "owner" | "admin" | "user";
  status: "invited" | "active" | "disabled" | "deleted";
  invited_at: string | null;
  invited_by: string | null;
  last_invited_at: string | null;
  accepted_at: string | null;
  disabled_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  can_manage_integrations: boolean;
  can_manage_billing: boolean;
}

export interface UseUsersResult {
  users: TenantUser[];
  currentUser: TenantUser | null;
  tenantId: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  callAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  actionLoading: string | null;
}

/**
 * Tenant users + the current user's own tenant_users row.
 * Both live in the shared cache, so every consumer (Settings tabs, Dashboard,
 * Structures, sidebar) shares a single fetch per freshness window.
 */
export function useTenantUsers(): UseUsersResult {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const myTuQuery = useMyTenantUserQuery();
  const myTu = (myTuQuery.data ?? null) as TenantUser | null;
  const tenantId = myTu?.tenant_id ?? null;

  const usersQuery = useQuery({
    queryKey: qk.tenantUsers(tenantId),
    enabled: !!tenantId,
    staleTime: staleTimes.identity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_users")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TenantUser[];
    },
  });

  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.myTenantUser(user?.id) }),
      queryClient.invalidateQueries({ queryKey: qk.tenantUsers(tenantId) }),
    ]);
  }, [queryClient, tenantId, user?.id]);

  const callAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const token = session?.access_token;
      if (!token || !tenantId) throw new Error("Not authenticated");

      const key = (payload.tenant_user_id as string) ?? action;
      setActionLoading(key);
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ action, tenant_id: tenantId, ...payload }),
          }
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Request failed");
        await reload();
      } finally {
        setActionLoading(null);
      }
    },
    [session?.access_token, tenantId, reload]
  );

  const loading = myTuQuery.isLoading || (!!tenantId && usersQuery.isLoading && !usersQuery.data);

  return {
    users: usersQuery.data ?? [],
    currentUser: myTu,
    tenantId,
    loading,
    reload,
    callAction,
    actionLoading,
  };
}
