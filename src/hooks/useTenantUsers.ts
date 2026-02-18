import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
      setLoading(false);
      return;
    }
    setLoading(true);

    // Step 1: backfill link by email if needed (safe security-definer RPC)
    await supabase.rpc("link_tenant_user_on_login" as any);

    // Step 2: get current user's tenant_user row via security-definer to bypass RLS race
    const { data: myTuRaw } = await supabase.rpc("get_my_tenant_user" as any);
    const myTu = myTuRaw as TenantUser | null;

    console.log("[useTenantUsers] currentTenantId:", myTu?.tenant_id ?? null);
    console.log("[useTenantUsers] currentRole:", myTu?.role ?? null);
    console.log("[useTenantUsers] currentStatus:", myTu?.status ?? null);

    if (!myTu?.tenant_id) {
      setCurrentUser(null);
      setTenantId(null);
      setUsers([]);
      setLoading(false);
      return;
    }

    setCurrentUser(myTu);
    setTenantId(myTu.tenant_id);

    // Step 3: Fetch all users in the tenant (RLS will enforce owner/admin-only reads)
    const { data, error } = await supabase
      .from("tenant_users")
      .select("*")
      .eq("tenant_id", myTu.tenant_id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[useTenantUsers] fetch error:", error.message);
    }

    if (!error && data) {
      setUsers(data as TenantUser[]);
    }

    setLoading(false);
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
