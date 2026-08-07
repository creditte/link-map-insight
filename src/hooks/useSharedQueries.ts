import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { qk, staleTimes } from "@/lib/queryKeys";

/**
 * Shared, deduplicated fetchers for resources that are needed by more than
 * one page/tab. Components call these instead of running their own
 * useEffect + fetch, so switching tabs re-uses cached data (stale-while-
 * revalidate) instead of refetching from scratch.
 */

/** The signed-in user's profile row (tenant link). */
export function useProfileQuery() {
  const { user, bootStatus } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: qk.profile(userId),
    enabled: !!userId && bootStatus !== "booting",
    staleTime: staleTimes.identity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("tenant_id, full_name, onboarding_complete, status")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Convenience: the current tenant id, cached via the profile query. */
export function useTenantId() {
  const { data } = useProfileQuery();
  return data?.tenant_id ?? null;
}

/** Current user's tenant_users row (role/permissions). */
export function useMyTenantUserQuery() {
  const { user, bootStatus } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: qk.myTenantUser(userId),
    enabled: !!userId && bootStatus !== "booting",
    staleTime: staleTimes.identity,
    queryFn: async () => {
      // Keeps tenant_users ↔ profile linkage in sync on first load of a session.
      await supabase.rpc("link_tenant_user_on_login" as any);
      const { data, error } = await supabase.rpc("get_my_tenant_user" as any);
      if (error) throw error;
      return (data ?? null) as any;
    },
  });
}

/** Xero / XPM connection record — shared by Dashboard, Structures, Settings. */
export function useXeroConnectionQuery(options?: Partial<UseQueryOptions<any>>) {
  return useQuery({
    queryKey: qk.xeroConnection(),
    staleTime: staleTimes.integration,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_xero_connection_info");
      if (error) throw error;
      return data && (data as unknown) !== "null" ? (data as any) : null;
    },
    ...(options as any),
  });
}

/** Cache-invalidation helpers, so mutations refresh only what they touched. */
export function useCacheInvalidation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return {
    /** Firm settings changed (name, branding, export defaults). */
    invalidateTenant: useCallback(
      (tenantId?: string | null) => {
        queryClient.invalidateQueries({ queryKey: ["tenant"] });
        if (tenantId) queryClient.invalidateQueries({ queryKey: qk.tenant(tenantId) });
      },
      [queryClient]
    ),
    /** Users invited / disabled / role changed. */
    invalidateUsers: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
      queryClient.invalidateQueries({ queryKey: qk.myTenantUser(userId) });
    }, [queryClient, userId]),
    /** Xero connected / disconnected / re-authorised. */
    invalidateXero: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: qk.xeroConnection() });
    }, [queryClient]),
    /** Subscription changed (plan switch, portal return). */
    invalidateBilling: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: qk.billing(userId) });
    }, [queryClient, userId]),
    /** Structures created / deleted / imported / archived. */
    invalidateStructures: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: qk.manualStructures(userId) });
      queryClient.invalidateQueries({ queryKey: qk.recentStructures(userId) });
      queryClient.invalidateQueries({ queryKey: qk.dashboardStats(userId) });
      queryClient.invalidateQueries({ queryKey: qk.billing(userId) });
    }, [queryClient, userId]),
    queryClient,
  };
}
