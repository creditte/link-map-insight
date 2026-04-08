import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { trace } from "@/lib/bootTrace";

// ── Boot state machine ──────────────────────────────────────────────
export type BootStatus = "booting" | "authenticated" | "unauthenticated" | "error" | "timeout";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  bootStatus: BootStatus;
  bootError: string | null;
  signOut: () => Promise<void>;
}

const BOOT_TIMEOUT_MS = 10_000;

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  bootStatus: "booting",
  bootError: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [bootStatus, setBootStatus] = useState<BootStatus>("booting");
  const [bootError, setBootError] = useState<string | null>(null);
  const bootResolved = useRef(false);

  trace("useAuth", "provider mount", { bootStatus: "booting" });

  useEffect(() => {
    // ── Timeout guard ───────────────────────────────────────────
    const timeout = setTimeout(async () => {
      if (!bootResolved.current) {
        bootResolved.current = true;
        trace("useAuth", "TIMEOUT – clearing session", { ms: BOOT_TIMEOUT_MS });
        console.error("[Auth] Boot timeout after", BOOT_TIMEOUT_MS, "ms – signing out");
        try { localStorage.removeItem("td_token"); } catch { /* noop */ }
        await supabase.auth.signOut().catch(() => {});
        setSession(null);
        setUser(null);
        setBootStatus("unauthenticated");
        setBootError(`Authentication timed out after ${BOOT_TIMEOUT_MS / 1000}s`);
      }
    }, BOOT_TIMEOUT_MS);

    const finishBoot = (s: Session | null) => {
      if (bootResolved.current) return;
      bootResolved.current = true;
      clearTimeout(timeout);
      const newStatus = s?.user ? "authenticated" : "unauthenticated";
      trace("useAuth", `finishBoot → ${newStatus}`, { userId: s?.user?.id ?? null });
      setSession(s);
      setUser(s?.user ?? null);
      setBootStatus(newStatus);
    };

    const failBoot = (err: unknown) => {
      if (bootResolved.current) return;
      bootResolved.current = true;
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      trace("useAuth", "failBoot → error", { error: msg });
      console.error("[Auth] Boot error:", msg);
      setBootStatus("error");
      setBootError(msg);
    };

    // ── Auth state listener (set up BEFORE getSession) ──────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        trace("useAuth", `onAuthStateChange(${_event})`, { userId: s?.user?.id ?? null, bootResolved: bootResolved.current });
        setSession(s);
        setUser(s?.user ?? null);
        if (bootResolved.current) {
          setBootStatus(s?.user ? "authenticated" : "unauthenticated");
        } else {
          finishBoot(s);
        }
      }
    );

    // ── Initial session fetch ───────────────────────────────────
    trace("useAuth", "getSession start");
    supabase.auth.getSession().then(
      async ({ data: { session: s }, error }) => {
        trace("useAuth", "getSession resolved", { hasSession: !!s, error: error?.message ?? null });
        if (error) {
          failBoot(error);
          return;
        }
        // If we have a cached session, validate it against the server
        // to catch expired/revoked tokens that getSession returns from storage
        if (s?.user) {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData?.user) {
            trace("useAuth", "getUser failed – stale session, signing out", { error: userError?.message });
            console.warn("[Auth] Stale session detected, clearing and redirecting to login");
            await supabase.auth.signOut();
            try { localStorage.removeItem("td_token"); } catch { /* noop */ }
            finishBoot(null);
            return;
          }
        }
        finishBoot(s);
      },
      (err) => {
        trace("useAuth", "getSession rejected", { error: String(err) });
        failBoot(err);
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    trace("useAuth", "signOut called");
    try { localStorage.removeItem("td_token"); } catch { /* noop */ }
    await supabase.auth.signOut();
    setBootStatus("unauthenticated");
  };

  const loading = bootStatus === "booting";

  return (
    <AuthContext.Provider value={{ user, session, loading, bootStatus, bootError, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
