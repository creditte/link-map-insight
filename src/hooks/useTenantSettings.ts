import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withTimeout } from "@/lib/bootTimeout";

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
}

export type TenantLoadStatus = "idle" | "loading" | "loaded" | "error" | "timeout";

export function useTenantSettings() {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TenantLoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setStatus("loaded");
      return;
    }
    setLoading(true);
    setStatus("loading");
    setError(null);

    try {
      const { data: profile } = await withTimeout(
        supabase.from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle(),
        TENANT_TIMEOUT_MS,
        "fetch profile"
      );

      if (!profile) {
        setStatus("loaded");
        return;
      }

      const { data } = await withTimeout(
        supabase.from("tenants").select("*").eq("id", profile.tenant_id).maybeSingle(),
        TENANT_TIMEOUT_MS,
        "fetch tenant"
      );

      if (data) {
        setTenant({
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
        });
      }
      setStatus("loaded");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useTenantSettings]", msg);
      setError(msg);
      setStatus(msg.includes("timeout") ? "timeout" : "error");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  return { tenant, loading, status, error, reload: load };
}
