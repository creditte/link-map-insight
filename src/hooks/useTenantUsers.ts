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
    if (!user?.id) return;
    setLoading(true);

    // Get tenant_id from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }

    const tid = profile.tenant_id;
    setTenantId(tid);

    // Fetch tenant_users (RLS will filter by role)
    const { data, error } = await supabase
      .from("tenant_users")
      .select("*")
      .eq("tenant_id", tid)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setUsers(data as TenantUser[]);
      const me = data.find((u: TenantUser) => u.auth_user_id === user.id) as TenantUser | undefined;
      setCurrentUser(me ?? null);
    }

    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) reload();
  }, [user?.id, reload]);

  const callAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const token = session?.access_token;
      if (!token || !tenantId) throw new Error("Not authenticated");

      const key = payload.tenant_user_id as string ?? action;
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
