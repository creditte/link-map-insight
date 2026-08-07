import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withTimeout } from "@/lib/bootTimeout";
import { trace } from "@/lib/bootTrace";
import { qk, staleTimes } from "@/lib/queryKeys";
import { useProfileQuery } from "@/hooks/useSharedQueries";

const TENANT_TIMEOUT_MS = 10_000;

export interface TenantSettings {
  id: string;
  name: string;
  firm_name: string;
  logo_url: string | null;
  brand_primary_color: string | null;
  export_footer_text: string | null;
  export_disclaimer_text: string | null;
  export_show_disclaimer: boolean;
  export_block_on_critical_health: boolean;
  export_default_view_mode: string;
  allow_admin_integrations: boolean;
  subscription_status: string;
  access_enabled: boolean;
  diagram_limit: number;
  diagram_count: number;
  /** Raw row, for screens that need columns not mapped above. */
  raw: Record<string, any>;
}

export type TenantLoadStatus = "idle" | "loading" | "loaded" | "no-profile" | "no-tenant" | "error" | "timeout";

function mapTenant(data: any): TenantSettings {
  return {
    id: data.id,
    name: data.name,
    firm_name: data.firm_name ?? data.name,
    logo_url: data.logo_url ?? null,
    brand_primary_color: data.brand_primary_color ?? null,
    export_footer_text: data.export_footer_text ?? null,
    export_disclaimer_text: data.export_disclaimer_text ?? null,
    export_show_disclaimer: data.export_show_disclaimer ?? false,
    export_block_on_critical_health: data.export_block_on_critical_health ?? false,
    export_default_view_mode: data.export_default_view_mode ?? "full",
    allow_admin_integrations: data.allow_admin_integrations ?? false,
    subscription_status: data.subscription_status ?? "trialing",
    access_enabled: data.access_enabled ?? true,
    diagram_limit: data.diagram_limit ?? 3,
    diagram_count: data.diagram_count ?? 0,
    raw: data,
  };
}

/**
 * Firm (tenant) settings, cached in the shared query cache. The profile →
 * tenant lookup happens once per session; tab and route changes reuse the
 * cached row and only revalidate in the background when it goes stale.
 */
export function useTenantSettings() {
  const { user, bootStatus } = useAuth();
  const queryClient = useQueryClient();
  const profileQuery = useProfileQuery();
  const tenantId = profileQuery.data?.tenant_id ?? null;

  const tenantQuery = useQuery({
    queryKey: qk.tenant(tenantId),
    enabled: !!tenantId,
    staleTime: staleTimes.tenant,
    queryFn: async () => {
      trace("useTenantSettings", "fetching tenant", { tenantId });
      const { data, error } = await withTimeout(
        supabase.from("tenants").select("*").eq("id", tenantId!).maybeSingle(),
        TENANT_TIMEOUT_MS,
        "fetch tenant"
      );
      if (error) throw error;
      return data ? mapTenant(data) : null;
    },
  });

  const reload = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.profile(user?.id) });
    if (tenantId) queryClient.invalidateQueries({ queryKey: qk.tenant(tenantId) });
  }, [queryClient, tenantId, user?.id]);

  const err = (profileQuery.error ?? tenantQuery.error) as Error | null;
  const errMsg = err ? err.message : null;

  let status: TenantLoadStatus = "loading";
  if (bootStatus !== "booting" && !user?.id) status = "no-profile";
  else if (errMsg) status = errMsg.includes("timeout") ? "timeout" : "error";
  else if (profileQuery.isSuccess && !profileQuery.data) status = "no-profile";
  else if (tenantQuery.isSuccess && !tenantQuery.data) status = "no-tenant";
  else if (tenantQuery.data) status = "loaded";

  const loading =
    status === "loading" &&
    (profileQuery.isLoading || tenantQuery.isLoading || (!!tenantId && !tenantQuery.data));

  return {
    tenant: tenantQuery.data ?? null,
    loading: bootStatus === "booting" ? true : loading,
    status,
    error: errMsg,
    reload,
  };
}
