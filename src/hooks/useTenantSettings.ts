import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

export function useTenantSettings() {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile) { setLoading(false); return; }

      const { data } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", profile.tenant_id)
        .maybeSingle();

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
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  return { tenant, loading, reload: load };
}
