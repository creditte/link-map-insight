import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { qk, staleTimes } from "@/lib/queryKeys";

export interface BillingStatus {
  enforcement_enabled: boolean;
  payment_method_required: boolean;
  payment_method_captured: boolean;
  subscription_status: string;
  subscription_plan: string | null;
  selected_plan: string | null;
  pending_downgrade: string | null;
  access_enabled: boolean;
  access_locked_reason: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  diagram_limit: number;
  diagram_count: number;
  cancel_at_period_end: boolean;
  billing_interval: string | null;
  price_amount: number | null;
  last_plan_switch_at: string | null;
}

/**
 * Subscription status. Shared through the query cache so opening the Billing
 * tab (or the Dashboard/Structures limit checks) reuses one check-subscription
 * call per freshness window instead of one per mount.
 *
 * Stripe billing logic itself is untouched — only the fetch caching changed.
 */
export function useBilling() {
  const { user, bootStatus } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery<BillingStatus | null>({
    queryKey: qk.billing(userId),
    enabled: bootStatus === "authenticated" && !!userId,
    staleTime: staleTimes.billing,
    queryFn: async () => {
      const { data, error: fnError } = await supabase.functions.invoke("check-subscription");
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      return data as BillingStatus;
    },
  });

  const reload = useCallback(
    async (_opts?: { background?: boolean }) => {
      await queryClient.invalidateQueries({ queryKey: qk.billing(userId) });
    },
    [queryClient, userId]
  );

  const openPortal = async () => {
    const { data, error } = await supabase.functions.invoke("customer-portal");
    if (error || data?.error) throw new Error(data?.error || error?.message);
    window.open(data.url, "_blank");
  };

  const startCheckout = async () => {
    const { data, error } = await supabase.functions.invoke("create-checkout");
    if (error || data?.error) throw new Error(data?.error || error?.message);
    if (data.url) window.location.href = data.url;
  };

  const switchBillingInterval = async () => {
    const { data, error } = await supabase.functions.invoke("switch-billing-interval");
    if (error || data?.error) throw new Error(data?.error || error?.message);
    await reload();
    return data;
  };

  const changePlan = async (targetPlan: "starter" | "pro") => {
    const { data, error } = await supabase.functions.invoke("change-plan", {
      body: { target_plan: targetPlan },
    });
    if (error || data?.error) throw new Error(data?.error || error?.message);
    await reload();
    return data;
  };

  return {
    billing: query.data ?? null,
    // Only block on the very first load; later revalidations stay in the background.
    loading: query.isLoading && !query.data,
    error: query.error ? (query.error as Error).message : null,
    reload,
    openPortal,
    startCheckout,
    switchBillingInterval,
    changePlan,
  };
}
