import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw, Unplug, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import XeroLogo from "@/components/XeroLogo";
import XeroErrorAlert from "@/components/XeroErrorAlert";
import { xeroToastPayload } from "@/lib/xeroErrors";
import { useXeroConnection } from "@/contexts/XeroConnectionContext";

interface XeroConnection {
  id: string;
  connected_at: string;
  xero_tenant_id: string | null;
  xero_org_name: string | null;
}

export default function IntegrationsSettings() {
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<XeroConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [xeroError, setXeroError] = useState<unknown>(null);
  const {
    invalid: xeroInvalid,
    reportError: reportXeroError,
    reload: reloadXeroConnection,
    clearInvalid: clearXeroInvalid,
  } = useXeroConnection();

  async function load() {
    setLoading(true);
    const { data } = await supabase.rpc("get_xero_connection_info");
    setConnection(data && data !== "null" ? (data as any) : null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setXeroError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) throw new Error("You must be signed in to connect Xero.");
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
        // ignore parse errors — handled below
      }
      const oauthUrl = data?.url || data?.oauth_url || data?.auth_url;
      if (!res.ok || !oauthUrl) {
        throw new Error(data?.error || "Couldn't start Xero sign-in.");
      }
      window.location.href = oauthUrl;
    } catch (err: unknown) {
      setXeroError(err);
      const payload = xeroToastPayload(err);
      toast.error(payload.title, { description: payload.description });
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setXeroError(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-xpm");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.started) {
        toast.success(
          data.message ||
            "XPM sync started. Refresh the dashboard in a minute or two to see updated entities.",
        );
      } else {
        toast.success("XPM sync complete.");
      }
    } catch (err: unknown) {
      setXeroError(err);
      reportXeroError(err);
      const payload = xeroToastPayload(err);
      toast.error(payload.title, { description: payload.description });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("xero-disconnect", {
        body: { connection_id: connection.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setConnection(null);
      setXeroError(null);
      clearXeroInvalid();
      await reloadXeroConnection();
      toast.success("Disconnected from Xero.");
    } catch (err: unknown) {
      const payload = xeroToastPayload(err);
      toast.error(payload.title, { description: payload.description });
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Manage third-party services your firm has connected to strukcha.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#13B5EA]/10">
            <XeroLogo className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">Xero Practice Manager</CardTitle>
              {connection && xeroInvalid ? (
                <Badge variant="outline" className="gap-1 border-amber-400 bg-amber-50 text-amber-800">
                  <AlertTriangle className="h-3 w-3" /> Connection lost
                </Badge>
              ) : connection ? (
                <Badge className="bg-[#13B5EA]/10 text-[#0d8ab8] hover:bg-[#13B5EA]/15 border-[#13B5EA]/30 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              Import clients, groups and relationships from Xero Practice Manager (XPM) into your structures.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {xeroError && (
            <XeroErrorAlert
              error={xeroError}
              onRetry={connection ? handleSync : handleConnect}
              retrying={syncing || connecting}
              onReconnect={handleConnect}
              reconnecting={connecting}
            />
          )}
          {connection ? (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Organisation</p>
                    <p className="font-medium text-foreground">
                      {connection.xero_org_name || "Xero organisation"}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Linked {new Date(connection.connected_at).toLocaleDateString("en-AU")}
                  </p>
                </div>
              </div>
              {xeroInvalid && (
                <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Reconnect Xero to keep syncing</p>
                  <p className="mt-0.5 text-amber-800">
                    Your Xero sign-in is no longer valid, so syncing is paused. Click{" "}
                    <span className="font-medium">Reconnect to Xero</span> below to restore access.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {xeroInvalid ? (
                  <Button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="gap-2 bg-[#13B5EA] text-white hover:bg-[#0f9dcc]"
                  >
                    {connecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XeroLogo className="h-4 w-4" />
                    )}
                    {connecting ? "Redirecting to Xero…" : "Reconnect to Xero"}
                  </Button>
                ) : (
                  <Button
                    onClick={handleSync}
                    disabled={syncing || xeroInvalid}
                    variant="outline"
                    className="gap-2"
                  >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {syncing ? "Syncing XPM…" : "Sync XPM"}
                  </Button>
                )}
                <Button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  variant="ghost"
                  className="gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                  {disconnecting ? "Disconnecting…" : "Disconnect Xero"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in with your Xero account to link your Practice Manager organisation. You will
                be redirected to Xero to authorise the connection and returned here when done.
              </p>
              <Button
                onClick={handleConnect}
                disabled={connecting}
                className="gap-2 bg-[#13B5EA] text-white hover:bg-[#0f9dcc]"
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XeroLogo className="h-4 w-4" />
                )}
                {connecting ? "Redirecting to Xero…" : "Connect to Xero"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
