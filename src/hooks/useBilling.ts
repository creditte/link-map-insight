import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface BillingStatus {
  subscription_status: string;
  subscription_plan: string | null;
  access_enabled: boolean;
  access_locked_reason: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  diagram_limit: number;
  diagram_count: number;
  cancel_at_period_end: boolean;
  billing_interval: string | null;
  price_amount: number | null;
}

export function useBilling() {
  const { user, bootStatus } = useAuth();
  const userId = user?.id ?? null;
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (bootStatus !== "authenticated" || !userId) {
      hasLoadedRef.current = false;
      setBilling(null);
      setError(null);
      setLoading(false);
      return;
    }

    const shouldShowBlockingLoader = !hasLoadedRef.current && !background;

    try {
      if (shouldShowBlockingLoader) {
        setLoading(true);
      }

      const { data, error: fnError } = await supabase.functions.invoke("check-subscription");
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setBilling(data);
      setError(null);
      hasLoadedRef.current = true;
    } catch (err: any) {
      console.error("[useBilling]", err.message);
      setError(err.message);
    } finally {
      if (shouldShowBlockingLoader || !hasLoadedRef.current) {
        setLoading(false);
      }
    }
  }, [bootStatus, userId]);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !userId) {
      hasLoadedRef.current = false;
      setBilling(null);
      setError(null);
      setLoading(false);
      return;
    }

    void load();
  }, [bootStatus, userId, load]);


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
    // Refresh billing data after switch
    await load({ background: true });
    return data;
  };

  return { billing, loading, error, reload: load, openPortal, startCheckout, switchBillingInterval };
}
