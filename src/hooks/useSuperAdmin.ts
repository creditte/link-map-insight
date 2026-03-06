import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useSuperAdmin() {
  const { user, bootStatus } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !user) {
      setLoading(false);
      setIsSuperAdmin(false);
      return;
    }

    supabase
      .from("super_admins")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        setIsSuperAdmin(!!data && !error);
        setLoading(false);
      });
  }, [user, bootStatus]);

  return { isSuperAdmin, loading };
}
