import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { trace } from "@/lib/bootTrace";

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

export function useTenantUsers(): UseUsersResult {
  const { user, session } = useAuth();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [currentUser, setCurrentUser] = useState<TenantUser | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user?.id) {
      trace("useTenantUsers", "no user → skip");
      setLoading(false);
      return;
    }
    setLoading(true);
    trace("useTenantUsers", "reload start", { userId: user.id });

    try {
      // Step 1: backfill link
      trace("useTenantUsers", "calling link_tenant_user_on_login");
      await supabase.rpc("link_tenant_user_on_login" as any);

      // Step 2: get current user's tenant_user row
      trace("useTenantUsers", "calling get_my_tenant_user");
      const { data: myTuRaw, error: rpcErr } = await supabase.rpc("get_my_tenant_user" as any);

      if (rpcErr) {
        trace("useTenantUsers", "get_my_tenant_user error", { error: rpcErr.message });
      }

      const myTu = myTuRaw as TenantUser | null;
      trace("useTenantUsers", "get_my_tenant_user result", {
        tenantId: myTu?.tenant_id ?? null,
        role: myTu?.role ?? null,
        status: myTu?.status ?? null,
      });

      if (!myTu?.tenant_id) {
        setCurrentUser(null);
        setTenantId(null);
        setUsers([]);
        setLoading(false);
        return;
      }

      setCurrentUser(myTu);
      setTenantId(myTu.tenant_id);

      // Step 3: Fetch all users in the tenant
      trace("useTenantUsers", "fetching tenant_users list");
      const { data, error } = await supabase
        .from("tenant_users")
        .select("*")
        .eq("tenant_id", myTu.tenant_id)
        .order("created_at", { ascending: true });

      if (error) {
        trace("useTenantUsers", "tenant_users fetch error", { error: error.message });
        console.error("[useTenantUsers] fetch error:", error.message);
      }

      if (!error && data) {
        setUsers(data as TenantUser[]);
        trace("useTenantUsers", "loaded users", { count: data.length });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace("useTenantUsers", "unexpected error", { error: msg });
      console.error("[useTenantUsers] unexpected error:", msg);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    reload();
  }, [user?.id, reload]);

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

  return { users, currentUser, tenantId, loading, reload, callAction, actionLoading };
}
