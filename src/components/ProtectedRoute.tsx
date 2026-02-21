import { Navigate } from "react-router-dom";
import { useAuth, BootStatus } from "@/hooks/useAuth";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { Shield } from "lucide-react";
import RecoveryScreen from "@/components/RecoveryScreen";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { bootStatus, bootError } = useAuth();
  const { tenant, loading: tenantLoading, status: tenantStatus, error: tenantError } = useTenantSettings();

  // ── Error / timeout states → recovery screen ──────────────────
  if (bootStatus === "error" || bootStatus === "timeout") {
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // ── Unauthenticated ───────────────────────────────────────────
  if (bootStatus === "unauthenticated") {
    return <Navigate to="/auth" replace />;
  }

  // ── Tenant loading states ─────────────────────────────────────
  if (tenantStatus === "timeout" || tenantStatus === "error") {
    return (
      <RecoveryScreen
        title={tenantStatus === "timeout" ? "Connection Timeout" : "Failed to Load Firm"}
        message="We couldn't load your firm settings. Please reload or try again."
        error={tenantError ?? undefined}
      />
    );
  }

  if (tenantLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center space-y-4 p-6">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="text-xl font-semibold">No Firm Assigned</h2>
          <p className="text-muted-foreground">
            Your account isn't assigned to a firm yet. Ask your admin to invite you again.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
