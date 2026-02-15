import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useOnboarding() {
  const { user } = useAuth();
  const [complete, setComplete] = useState(true); // default true to avoid flash
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("onboarding_complete")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        setComplete(data?.onboarding_complete ?? true);
        setLoading(false);
      });
  }, [user?.id]);

  const dismiss = useCallback(async () => {
    setComplete(true);
    if (!user?.id) return;
    await supabase
      .from("profiles")
      .update({ onboarding_complete: true })
      .eq("user_id", user.id);
  }, [user?.id]);

  return { showOnboarding: !loading && !complete, dismiss };
}
