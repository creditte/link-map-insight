import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, LogIn } from "lucide-react";

interface RecoveryScreenProps {
  title?: string;
  message?: string;
  error?: string;
}

export default function RecoveryScreen({
  title = "Something went wrong",
  message = "Something went wrong while starting the app.",
  error,
}: RecoveryScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-5">
        <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>

        <div className="flex items-center justify-center gap-3">
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/login";
            }}
            className="gap-2"
          >
            <LogIn className="h-4 w-4" /> Go to Login
          </Button>
        </div>

        <div className="rounded border p-3 text-left text-xs text-muted-foreground space-y-1 mt-4">
          <p><strong>Diagnostics</strong></p>
          <p>Timestamp: {new Date().toISOString()}</p>
          <p>Build: {import.meta.env.MODE}</p>
          {error && <p className="break-all">Error: {error}</p>}
        </div>
      </div>
    </div>
  );
}
