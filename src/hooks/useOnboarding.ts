import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { qk } from "@/lib/queryKeys";
import { useProfileQuery } from "@/hooks/useSharedQueries";

/**
 * Onboarding walkthrough visibility. Reads the cached profile row instead of
 * issuing its own profile fetch on every mount.
 */
export function useOnboarding() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useProfileQuery();

  const complete = data?.onboarding_complete ?? true;

  const dismiss = useCallback(async () => {
    if (!user?.id) return;
    // Optimistic: hide immediately, then persist.
    queryClient.setQueryData(qk.profile(user.id), (prev: any) =>
      prev ? { ...prev, onboarding_complete: true } : prev
    );
    await supabase.from("profiles").update({ onboarding_complete: true }).eq("user_id", user.id);
  }, [user?.id, queryClient]);

  return { showOnboarding: !isLoading && !complete, dismiss };
}
