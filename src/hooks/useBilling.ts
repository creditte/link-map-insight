import { useState, useEffect, useCallback } from "react";
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
}

export function useBilling() {
  const { user, bootStatus } = useAuth();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (bootStatus !== "authenticated" || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error: fnError } = await supabase.functions.invoke("check-subscription");
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setBilling(data);
      setError(null);
    } catch (err: any) {
      console.error("[useBilling]", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, bootStatus]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh every 60s
  useEffect(() => {
    if (bootStatus !== "authenticated") return;
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load, bootStatus]);

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

  return { billing, loading, error, reload: load, openPortal, startCheckout };
}
