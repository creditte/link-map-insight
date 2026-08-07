import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { qk, staleTimes } from "@/lib/queryKeys";
import { useTenantId } from "@/hooks/useSharedQueries";

/**
 * Duplicate-entity badge count. Cached — the sidebar/Review page no longer
 * re-runs the two duplicate RPCs on every mount.
 */
export function useDuplicateCount() {
  const { session } = useAuth();
  const tenantId = useTenantId();

  const query = useQuery({
    queryKey: qk.duplicateCount(session?.user?.id ?? null),
    enabled: !!session?.user && !!tenantId,
    staleTime: staleTimes.stats,
    queryFn: async () => {
      const [{ data: exact }, { data: fuzzy }] = await Promise.all([
        supabase.rpc("find_duplicate_entities", { _tenant_id: tenantId! }),
        supabase.rpc("find_fuzzy_duplicate_entities", { _tenant_id: tenantId!, _threshold: 0.8 }),
      ]);

      const seen = new Set<string>();
      const addPair = (a: string, b: string) => {
        seen.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      };
      for (const row of exact ?? []) addPair(row.entity_id_a, row.entity_id_b);
      for (const row of fuzzy ?? []) addPair(row.entity_id_a, row.entity_id_b);
      return seen.size;
    },
  });

  return { duplicateCount: query.data ?? 0, loading: query.isLoading && query.data === undefined };
}
