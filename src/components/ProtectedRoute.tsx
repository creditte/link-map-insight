import { useState, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth, BootStatus } from "@/hooks/useAuth";
import { useTenantSettings, TenantLoadStatus } from "@/hooks/useTenantSettings";
import { useMfa } from "@/hooks/useMfa";
import { useBilling } from "@/hooks/useBilling";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";
import RecoveryScreen from "@/components/RecoveryScreen";
import { trace, getTrace, TraceEntry } from "@/lib/bootTrace";

type BootStep = "auth" | "firm" | "account" | "security" | "subscription";

const STEP_LABELS: Record<BootStep, string> = {
  auth: "Signing in",
  firm: "Loading workspace",
  account: "Setting up account",
  security: "Verifying security",
  subscription: "Checking plan",
};

function BootLoadingScreen({ currentStep }: { currentStep: BootStep }) {
  const steps: BootStep[] = ["auth", "firm", "account", "security", "subscription"];
  const currentIdx = steps.indexOf(currentStep);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-xs">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <div className="space-y-2 w-full">
          {steps.map((step, idx) => {
            const isDone = idx < currentIdx;
            const isActive = idx === currentIdx;
            return (
              <div key={step} className="flex items-center gap-2 text-sm">
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${isDone ? "bg-primary" : isActive ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                <span className={isDone ? "text-muted-foreground" : isActive ? "text-foreground font-medium" : "text-muted-foreground/40"}>
                  {STEP_LABELS[step]}{isActive ? "…" : isDone ? " ✓" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  // IMPORTANT: query AFTER tenant loading completes so link_tenant_user_on_login has run first
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    if (bootStatus !== "authenticated" || !user || tenantLoading) {
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
  }, [bootStatus, user, tenantLoading]);

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
    trace("ProtectedRoute", "decision: loading timeout → clearing session, redirect /login");
    supabase.auth.signOut().catch(() => {});
    return <Navigate to="/login" replace />;
  }

  // ── Auth error ─────────────────────────────────────────────────
  if (bootStatus === "error" || bootStatus === "timeout") {
    trace("ProtectedRoute", "decision: auth error/timeout → sign out & redirect /login");
    supabase.auth.signOut().catch(() => {});
    return <Navigate to="/login" replace />;
  }

  // ── Still booting auth ────────────────────────────────────────
  if (bootStatus === "booting") {
    trace("ProtectedRoute", "decision: auth booting → loading spinner");
    return <BootLoadingScreen currentStep="auth" />;
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
    return <BootLoadingScreen currentStep="firm" />;
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
    return <BootLoadingScreen currentStep="account" />;
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
    return <BootLoadingScreen currentStep="security" />;
  }

  if (mfaStatus === "not-enrolled") {
    return <Navigate to="/mfa-setup" replace />;
  }

  if (mfaStatus === "needs-verification") {
    return <Navigate to="/mfa-verify" replace />;
  }

  return <BillingGate>{children}</BillingGate>;
}

/** Check billing access after MFA is resolved */
function BillingGate({ children }: { children: React.ReactNode }) {
  const { billing, loading } = useBilling();

  if (loading) {
    return <BootLoadingScreen currentStep="subscription" />;
  }

  return <>{children}</>;
}
