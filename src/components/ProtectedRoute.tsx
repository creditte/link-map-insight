import { useState, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth, BootStatus } from "@/hooks/useAuth";
import { useTenantSettings, TenantLoadStatus } from "@/hooks/useTenantSettings";
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

function BootTraceOverlay() {
  const entries = getTrace();
  return (
    <div className="fixed inset-0 z-[9999] overflow-auto bg-background p-4 font-mono text-xs">
      <h2 className="text-sm font-bold mb-2">Boot Trace ({entries.length} entries)</h2>
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
    return <BootTraceOverlay />;
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
    trace("ProtectedRoute", "decision: unauthenticated → redirect /auth");
    return <Navigate to="/auth" replace />;
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

  return <>{children}</>;
}
