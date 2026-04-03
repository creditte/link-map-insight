import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useDuplicateCount() {
  const { session } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }

    async function fetch() {
      try {
        // Get tenant_id
        const { data: profile } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("user_id", session!.user.id)
          .maybeSingle();

        if (!profile?.tenant_id) {
          setLoading(false);
          return;
        }

        // Use exact match first, then fuzzy
        const { data: exact } = await supabase.rpc("find_duplicate_entities", {
          _tenant_id: profile.tenant_id,
        });

        const { data: fuzzy } = await supabase.rpc("find_fuzzy_duplicate_entities", {
          _tenant_id: profile.tenant_id,
          _threshold: 0.8,
        });

        // Deduplicate pairs by sorting IDs
        const seen = new Set<string>();
        const addPair = (a: string, b: string) => {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          seen.add(key);
        };

        for (const row of exact ?? []) addPair(row.entity_id_a, row.entity_id_b);
        for (const row of fuzzy ?? []) addPair(row.entity_id_a, row.entity_id_b);

        setCount(seen.size);
      } catch {
        // Silent fail — badge just won't show
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, [session?.user?.id]);

  return { duplicateCount: count, loading };
}
