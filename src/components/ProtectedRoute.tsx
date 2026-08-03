import { useState, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth, BootStatus } from "@/hooks/useAuth";
import { useTenantSettings, TenantLoadStatus } from "@/hooks/useTenantSettings";
import { useMfa } from "@/hooks/useMfa";
import { useBilling } from "@/hooks/useBilling";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Shield } from "lucide-react";
import RecoveryScreen from "@/components/RecoveryScreen";
import { trace, getTrace, TraceEntry } from "@/lib/bootTrace";

function BootLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5 max-w-xs px-4 text-center">
        <img
          src="/strukcha-icon-512x512.png"
          alt="strukcha"
          width={80}
          height={80}
          className="h-16 w-16 rounded-[22%] object-cover shadow-md ring-1 ring-border/60 animate-strukcha-boot motion-reduce:animate-none"
        />
        <p className="text-sm text-muted-foreground animate-pulse motion-reduce:animate-none">
          Loading your workspace…
        </p>
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
  const { isSuperAdmin } = useSuperAdmin();
  const showDebug = isSuperAdmin && searchParams.get("debug") === "boot";

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
    return <BootLoadingScreen />;
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
    return <BootLoadingScreen />;
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
    return <BootLoadingScreen />;
  }

  // ── Invite / Xero signup / recovery: must set password on /setup-password ───
  // Self-signup users set a password during signup; they are tagged with user_metadata.signup_source === "self_service".
  const needsInvitePasswordSetup =
    onboardingComplete === false && user?.user_metadata?.signup_source !== "self_service";
  if (needsInvitePasswordSetup) {
    return <Navigate to="/setup-password" replace />;
  }

  // ── MFA enforcement ───────────────────────────────────────────
  return <MfaGate>{children}</MfaGate>;
}

/** Inner component so useMfa only runs after auth + tenant are resolved */
function MfaGate({ children }: { children: React.ReactNode }) {
  const { status: mfaStatus, loading: mfaLoading } = useMfa();

  if (mfaLoading) {
    return <BootLoadingScreen />;
  }

  if (mfaStatus === "not-enrolled") {
    return <Navigate to="/mfa-setup" replace />;
  }

  if (mfaStatus === "needs-verification") {
    return <Navigate to="/mfa-verify" replace />;
  }

  return <BillingGate>{children}</BillingGate>;
}

/**
 * Check billing access after MFA is resolved.
 *
 * No-op while `billing_enforcement_enabled` is false: check-subscription returns
 * enforcement_enabled=false with access_enabled forced to true, so this gate
 * never fires until the flag is switched on.
 */
function BillingGate({ children }: { children: React.ReactNode }) {
  const { billing, loading } = useBilling();

  if (loading) {
    return <BootLoadingScreen />;
  }

  // Fail open when billing state can't be read — never lock a firm out on a
  // transient error; the DB triggers remain the hard backstop.
  if (billing?.enforcement_enabled === true && billing.access_enabled === false) {
    trace("ProtectedRoute", `decision: billing locked (${billing.access_locked_reason ?? "unknown"})`);
    return <Navigate to="/subscription-locked" replace />;
  }

  return <>{children}</>;
}
