import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// ── Boot state machine ──────────────────────────────────────────────
export type BootStatus = "booting" | "authenticated" | "unauthenticated" | "error" | "timeout";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean; // kept for backward compat – true only when booting
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

  useEffect(() => {
    // ── Timeout guard ───────────────────────────────────────────
    const timeout = setTimeout(() => {
      if (!bootResolved.current) {
        bootResolved.current = true;
        console.error("[Auth] Boot timeout after", BOOT_TIMEOUT_MS, "ms");
        setBootStatus("timeout");
        setBootError(`Authentication timed out after ${BOOT_TIMEOUT_MS / 1000}s`);
      }
    }, BOOT_TIMEOUT_MS);

    const finishBoot = (s: Session | null) => {
      if (bootResolved.current) return;
      bootResolved.current = true;
      clearTimeout(timeout);
      setSession(s);
      setUser(s?.user ?? null);
      setBootStatus(s?.user ? "authenticated" : "unauthenticated");
    };

    const failBoot = (err: unknown) => {
      if (bootResolved.current) return;
      bootResolved.current = true;
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Auth] Boot error:", msg);
      setBootStatus("error");
      setBootError(msg);
    };

    // ── Auth state listener (set up BEFORE getSession) ──────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        // After initial boot, keep state in sync
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
    supabase.auth.getSession().then(
      ({ data: { session: s }, error }) => {
        if (error) {
          // 401 / 403 – clear auth and go unauthenticated
          failBoot(error);
          return;
        }
        finishBoot(s);
      },
      (err) => failBoot(err)
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
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
