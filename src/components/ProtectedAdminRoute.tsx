import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Loader2, ShieldAlert } from "lucide-react";

export default function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { bootStatus } = useAuth();
  const { isSuperAdmin, loading } = useSuperAdmin();

  if (bootStatus === "booting" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bootStatus === "unauthenticated") {
    return <Navigate to="/auth" replace />;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-3">
          <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You do not have super admin privileges.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
