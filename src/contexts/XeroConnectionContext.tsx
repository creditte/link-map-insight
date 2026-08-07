import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { translateXeroError } from "@/lib/xeroErrors";
import { useXeroConnectionQuery } from "@/hooks/useSharedQueries";


export interface XeroConnectionInfo {
  id: string;
  connected_at: string | null;
  expires_at?: string;
  xero_tenant_id: string | null;
  xero_org_name: string | null;
  connected_by_email?: string | null;
}

interface XeroConnectionContextValue {
  /** Loaded connection record, if any. */
  connection: XeroConnectionInfo | null;
  /** True while the initial connection lookup is in flight. */
  loading: boolean;
  /**
   * True when the stored connection exists but Xero has told us it's no
   * longer valid (token expired, access revoked, missing scope, etc.).
   * All Xero-dependent actions should be disabled until this clears.
   */
  invalid: boolean;
  /** True when we're actively redirecting the user into Xero's OAuth flow. */
  reconnecting: boolean;
  /** Refetch the connection record from the backend. */
  reload: () => Promise<void>;
  /**
   * Report any error thrown by a Xero-related call. If the error indicates
   * the connection needs re-authorisation, the provider flips into the
   * "invalid" state and surfaces the reconnect banner.
   */
  reportError: (err: unknown) => void;
  /** Clear the invalid flag (e.g. after a successful reconnect). */
  clearInvalid: () => void;
  /** Kick off the Xero OAuth flow. Redirects the browser on success. */
  startReconnect: () => Promise<void>;
}

const XeroConnectionContext = createContext<XeroConnectionContextValue | null>(null);

export function XeroConnectionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<XeroConnectionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("get_xero_connection_info");
      if (!mounted.current) return;
      const parsed = data && data !== "null" ? (data as unknown as XeroConnectionInfo) : null;
      setConnection(parsed);
      // If the connection record disappeared, nothing to mark invalid on.
      if (!parsed) setInvalid(false);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Dev helper: allow forcing the "invalid connection" state from the console
  // via `window.dispatchEvent(new Event('xero-force-invalid'))` so the
  // reconnect banner can be tested without revoking access in Xero.
  useEffect(() => {
    const forceInvalid = () => setInvalid(true);
    const clear = () => setInvalid(false);
    window.addEventListener("xero-force-invalid", forceInvalid);
    window.addEventListener("xero-clear-invalid", clear);
    return () => {
      window.removeEventListener("xero-force-invalid", forceInvalid);
      window.removeEventListener("xero-clear-invalid", clear);
    };
  }, []);

  const reportError = useCallback((err: unknown) => {
    const friendly = translateXeroError(err);
    if (friendly.requiresReconnect) setInvalid(true);
  }, []);

  const clearInvalid = useCallback(() => setInvalid(false), []);

  const startReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) throw new Error("You must be signed in to reconnect Xero.");
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          origin: window.location.origin,
          connection_type: "practice_manager",
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      const oauthUrl = data?.url || data?.oauth_url || data?.auth_url;
      if (!res.ok || !oauthUrl) {
        throw new Error(data?.error || "Couldn't start Xero sign-in.");
      }
      window.location.href = oauthUrl;
    } catch (err) {
      if (mounted.current) setReconnecting(false);
      throw err;
    }
  }, []);

  return (
    <XeroConnectionContext.Provider
      value={{
        connection,
        loading,
        invalid,
        reconnecting,
        reload,
        reportError,
        clearInvalid,
        startReconnect,
      }}
    >
      {children}
    </XeroConnectionContext.Provider>
  );
}

export function useXeroConnection() {
  const ctx = useContext(XeroConnectionContext);
  if (!ctx) {
    throw new Error("useXeroConnection must be used inside <XeroConnectionProvider>");
  }
  return ctx;
}
