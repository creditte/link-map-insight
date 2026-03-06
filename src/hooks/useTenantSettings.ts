import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withTimeout } from "@/lib/bootTimeout";
import { trace } from "@/lib/bootTrace";

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

export type TenantLoadStatus = "idle" | "loading" | "loaded" | "no-profile" | "no-tenant" | "error" | "timeout";

export function useTenantSettings() {
  const { user, bootStatus } = useAuth();
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TenantLoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const loadCount = useRef(0);

  const load = useCallback(async () => {
    const run = ++loadCount.current;

    // ── Gate: don't load if auth hasn't resolved yet ────────────
    if (bootStatus === "booting") {
      trace("useTenantSettings", "skipping – auth still booting");
      return; // keep loading=true; auth will trigger re-run
    }

    if (!user?.id) {
      trace("useTenantSettings", "no user → terminal (no-profile)", { bootStatus });
      setLoading(false);
      setStatus("no-profile");
      return;
    }

    trace("useTenantSettings", "load start", { userId: user.id, run });
    setLoading(true);
    setStatus("loading");
    setError(null);

    try {
      // ── Step 0: sync tenant_users → profile link ─────────────
      trace("useTenantSettings", "calling link_tenant_user_on_login");
      await supabase.rpc("link_tenant_user_on_login" as any);

      // ── Step 1: fetch profile ─────────────────────────────────
      trace("useTenantSettings", "fetching profile");
      const { data: profile, error: profileErr } = await withTimeout(
        supabase.from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle(),
        TENANT_TIMEOUT_MS,
        "fetch profile"
      );

      if (run !== loadCount.current) return; // stale

      if (profileErr) {
        trace("useTenantSettings", "profile query error", { error: profileErr.message });
        throw profileErr;
      }

      if (!profile) {
        trace("useTenantSettings", "no profile row → terminal (no-profile)");
        setStatus("no-profile");
        return; // finally sets loading=false
      }

      // ── Step 2: fetch tenant ──────────────────────────────────
      trace("useTenantSettings", "fetching tenant", { tenantId: profile.tenant_id });
      const { data, error: tenantErr } = await withTimeout(
        supabase.from("tenants").select("*").eq("id", profile.tenant_id).maybeSingle(),
        TENANT_TIMEOUT_MS,
        "fetch tenant"
      );

      if (run !== loadCount.current) return; // stale

      if (tenantErr) {
        trace("useTenantSettings", "tenant query error", { error: tenantErr.message });
        throw tenantErr;
      }

      if (!data) {
        trace("useTenantSettings", "no tenant row → terminal (no-tenant)");
        setStatus("no-tenant");
        return; // finally sets loading=false
      }

      trace("useTenantSettings", "loaded OK", { tenantId: data.id, firmName: data.firm_name });
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
      setStatus("loaded");
    } catch (err) {
      if (run !== loadCount.current) return; // stale
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useTenantSettings]", msg);
      trace("useTenantSettings", "error", { error: msg });
      setError(msg);
      setStatus(msg.includes("timeout") ? "timeout" : "error");
    } finally {
      if (run === loadCount.current) {
        setLoading(false);
      }
    }
  }, [user?.id, bootStatus]);

  useEffect(() => { load(); }, [load]);

  return { tenant, loading, status, error, reload: load };
}
