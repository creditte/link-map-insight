import { useState, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth, BootStatus } from "@/hooks/useAuth";
import { useTenantSettings, TenantLoadStatus } from "@/hooks/useTenantSettings";
import { useMfa } from "@/hooks/useMfa";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";
import RecoveryScreen from "@/components/RecoveryScreen";
import { trace, getTrace, TraceEntry } from "@/lib/bootTrace";

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-xs text-muted-foreground">({elapsed}s)</span>;
}

/* ── Full Boot Debug Panel ──────────────────────────────────────────── */
function BootDebugPanel({
  bootStatus,
  tenantStatus,
  tenantLoading,
  userId,
  userEmail,
  hasTenant,
  tenantError,
}: {
  bootStatus: BootStatus;
  tenantStatus: TenantLoadStatus;
  tenantLoading: boolean;
  userId: string | null;
  userEmail: string | null;
  hasTenant: boolean;
  tenantError: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [swStatus, setSwStatus] = useState("checking…");
  const entries = getTrace();

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwStatus("not supported");
      return;
    }
    navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length === 0) {
        setSwStatus("none registered");
      } else {
        const controlling = navigator.serviceWorker.controller;
        setSwStatus(
          controlling
            ? `ACTIVE (scope: ${controlling.scriptURL})`
            : `registered (${regs.length}) but not controlling`
        );
      }
    });
  }, []);

  const buildTs = typeof __BUILD_TIMESTAMP__ !== "undefined" ? __BUILD_TIMESTAMP__ : "dev";

  return (
    <div className="fixed inset-0 z-[9999] overflow-auto bg-background p-4 font-mono text-xs">
      <h2 className="text-base font-bold mb-3">🔧 Boot Debug Panel</h2>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 max-w-xl">
        <span className="text-muted-foreground">Build:</span>
        <span className="font-semibold">{buildTs}</span>

        <span className="text-muted-foreground">Elapsed:</span>
        <span>{elapsed}s</span>

        <span className="text-muted-foreground">Service Worker:</span>
        <span className={swStatus.startsWith("ACTIVE") ? "text-destructive font-bold" : ""}>{swStatus}</span>

        <span className="text-muted-foreground">Auth Status:</span>
        <span className={`font-semibold ${bootStatus === "authenticated" ? "text-green-600" : "text-orange-500"}`}>
          {bootStatus}
        </span>

        <span className="text-muted-foreground">User ID:</span>
        <span>{userId ?? "—"}</span>

        <span className="text-muted-foreground">Email:</span>
        <span>{userEmail ?? "—"}</span>

        <span className="text-muted-foreground">Tenant Status:</span>
        <span className={`font-semibold ${tenantStatus === "loaded" ? "text-green-600" : "text-orange-500"}`}>
          {tenantStatus} {tenantLoading ? "(loading)" : ""}
        </span>

        <span className="text-muted-foreground">Has Tenant:</span>
        <span>{hasTenant ? "YES" : "NO"}</span>

        {tenantError && (
          <>
            <span className="text-muted-foreground">Tenant Error:</span>
            <span className="text-destructive">{tenantError}</span>
          </>
        )}
      </div>

      <h3 className="text-sm font-bold mb-2">Boot Trace ({entries.length} entries)</h3>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-1 w-20">+ms</th>
            <th className="p-1 w-36">Step</th>
            <th className="p-1">Label</th>
            <th className="p-1">Data</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="p-1 text-muted-foreground">{e.t}</td>
              <td className="p-1 font-semibold">{e.step}</td>
              <td className="p-1">{e.label}</td>
              <td className="p-1 text-muted-foreground break-all">
                {e.data !== undefined ? JSON.stringify(e.data) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LOADING_TIMEOUT_MS = 10_000;

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { bootStatus, bootError, user } = useAuth();
  const { tenant, loading: tenantLoading, status: tenantStatus, error: tenantError } = useTenantSettings();
  const [searchParams] = useSearchParams();
  const showDebug = searchParams.get("debug") === "boot";

  // Check onboarding_complete for password setup redirect
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !user) {
      setOnboardingChecked(false);
      return;
    }
    supabase
      .from("profiles")
      .select("onboarding_complete")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setOnboardingComplete(data?.onboarding_complete ?? false);
        setOnboardingChecked(true);
      });
  }, [bootStatus, user]);

  // ── Loading timeout – never stay on spinner forever ───────────
  const [timedOut, setTimedOut] = useState(false);
  const isStillLoading = bootStatus === "booting" || (bootStatus === "authenticated" && tenantLoading);

  useEffect(() => {
    if (!isStillLoading) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      trace("ProtectedRoute", "LOADING TIMEOUT", { bootStatus, tenantStatus, tenantLoading });
      setTimedOut(true);
    }, LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isStillLoading, bootStatus, tenantStatus, tenantLoading]);

  trace("ProtectedRoute", "render", { bootStatus, tenantStatus, tenantLoading, timedOut, hasTenant: !!tenant, hasUser: !!user });

  // ── Debug overlay ─────────────────────────────────────────────
  if (showDebug) {
    return (
      <BootDebugPanel
        bootStatus={bootStatus}
        tenantStatus={tenantStatus}
        tenantLoading={tenantLoading}
        userId={user?.id ?? null}
        userEmail={user?.email ?? null}
        hasTenant={!!tenant}
        tenantError={tenantError}
      />
    );
  }

  // ── Timed out waiting ─────────────────────────────────────────
  if (timedOut) {
    return (
      <RecoveryScreen
        title="Loading Timeout"
        message="The app took too long to load. This usually means a network issue or missing account data."
        error={`bootStatus=${bootStatus} tenantStatus=${tenantStatus} userId=${user?.id ?? "none"}`}
      />
    );
  }

  // ── Auth error / timeout ──────────────────────────────────────
  if (bootStatus === "error" || bootStatus === "timeout") {
    trace("ProtectedRoute", "decision: auth error/timeout → RecoveryScreen");
    return (
      <RecoveryScreen
        title={bootStatus === "timeout" ? "Connection Timeout" : "Authentication Error"}
        message={
          bootStatus === "timeout"
            ? "The app took too long to connect. Please check your network and try again."
            : "We couldn't verify your session. Please reload or sign in again."
        }
        error={bootError ?? undefined}
      />
    );
  }

  // ── Still booting auth ────────────────────────────────────────
  if (bootStatus === "booting") {
    trace("ProtectedRoute", "decision: auth booting → loading spinner");
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Authenticating… <ElapsedTimer /></p>
      </div>
    );
  }

  // ── Unauthenticated ───────────────────────────────────────────
  if (bootStatus === "unauthenticated") {
    trace("ProtectedRoute", "decision: unauthenticated → redirect /login");
    return <Navigate to="/login" replace />;
  }

  // ── Tenant: error / timeout ───────────────────────────────────
  if (tenantStatus === "timeout" || tenantStatus === "error") {
    trace("ProtectedRoute", "decision: tenant error/timeout → RecoveryScreen", { tenantStatus, tenantError });
    return (
      <RecoveryScreen
        title={tenantStatus === "timeout" ? "Connection Timeout" : "Failed to Load Firm"}
        message="We couldn't load your firm settings. Please reload or try again."
        error={tenantError ?? undefined}
      />
    );
  }

  // ── Tenant still loading ──────────────────────────────────────
  if (tenantLoading) {
    trace("ProtectedRoute", "decision: tenant loading → spinner");
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading firm settings… <ElapsedTimer /></p>
      </div>
    );
  }

  // ── No profile or no tenant row → TERMINAL, not loading ───────
  if (tenantStatus === "no-profile" || tenantStatus === "no-tenant" || !tenant) {
    trace("ProtectedRoute", `decision: terminal (${tenantStatus}) → No Firm Assigned`);
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center space-y-4 p-6">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="text-xl font-semibold">No Firm Assigned</h2>
          <p className="text-muted-foreground">
            Your account isn't assigned to a firm yet. Ask your admin to invite you again.
          </p>
          <p className="text-xs text-muted-foreground">
            Status: {tenantStatus} | User: {user?.email ?? "unknown"}
          </p>
        </div>
      </div>
    );
  }

  // ── Wait for onboarding check before allowing app access ──────
  if (bootStatus === "authenticated" && !onboardingChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking account setup… <ElapsedTimer /></p>
      </div>
    );
  }

  // ── Password setup required ────────────────────────────────────
  if (onboardingComplete === false) {
    return <Navigate to="/setup-password" replace />;
  }

  // ── MFA enforcement ───────────────────────────────────────────
  return <MfaGate>{children}</MfaGate>;
}

/** Inner component so useMfa only runs after auth + tenant are resolved */
function MfaGate({ children }: { children: React.ReactNode }) {
  const { status: mfaStatus, loading: mfaLoading } = useMfa();

  if (mfaLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking security settings… <ElapsedTimer /></p>
      </div>
    );
  }

  if (mfaStatus === "not-enrolled") {
    return <Navigate to="/mfa-setup" replace />;
  }

  if (mfaStatus === "needs-verification") {
    return <Navigate to="/mfa-verify" replace />;
  }

  return <>{children}</>;
}
