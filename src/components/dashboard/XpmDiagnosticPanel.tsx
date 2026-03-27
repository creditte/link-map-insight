import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Activity, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EndpointResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: any;
  truncated?: boolean;
}

interface DiagResult {
  xeroTenantId: string;
  xeroOrgName: string;
  authorizedConnections: any;
  workingEndpoints: EndpointResult[];
  failedEndpoints: { url: string; status: number; body: any }[];
}

export default function XpmDiagnosticPanel() {
  const [result, setResult] = useState<DiagResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("xpm-diagnostic");
      if (error) throw error;
      setResult(data as DiagResult);
      toast({
        title: "Diagnostic Complete",
        description: `${data?.workingEndpoints?.length ?? 0} endpoints working, ${data?.failedEndpoints?.length ?? 0} failed`,
      });
    } catch (err: any) {
      toast({ title: "Diagnostic Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">XPM API Endpoint Diagnostic</CardTitle>
        <Button onClick={handleRun} disabled={loading} variant="outline" size="sm" className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          {loading ? "Testing…" : "Run Diagnostic"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result && !loading && (
          <p className="text-sm text-muted-foreground">
            Tests multiple XPM API URL patterns to find which endpoints return data for your connected account.
          </p>
        )}

        {result && (
          <>
            {/* Connection info */}
            <div className="rounded-md border p-3 space-y-1">
              <p className="text-sm"><span className="font-medium">Org:</span> {result.xeroOrgName ?? "—"}</p>
              <p className="text-sm font-mono text-xs text-muted-foreground">Tenant ID: {result.xeroTenantId}</p>
              {result.authorizedConnections && Array.isArray(result.authorizedConnections) && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Authorized Connections:</p>
                  {result.authorizedConnections.map((c: any, i: number) => (
                    <div key={i} className="text-xs">
                      <Badge variant="outline" className="mr-1">{c.tenantType}</Badge>
                      {c.tenantName}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Working endpoints */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Working Endpoints ({result.workingEndpoints.length})
              </h3>
              {result.workingEndpoints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No endpoints returned success.</p>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  {result.workingEndpoints.map((ep, i) => (
                    <div key={i} className="rounded-md border p-3 mb-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="text-xs">{ep.status}</Badge>
                        <code className="text-xs break-all">{ep.url}</code>
                      </div>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-[200px]">
                        {JSON.stringify(ep.body, null, 2)}
                      </pre>
                    </div>
                  ))}
                </ScrollArea>
              )}
            </div>

            {/* Failed endpoints */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                Failed Endpoints ({result.failedEndpoints.length})
              </h3>
              <ScrollArea className="max-h-[200px]">
                {result.failedEndpoints.map((ep, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    <Badge variant="destructive" className="text-xs shrink-0">{ep.status}</Badge>
                    <code className="break-all text-muted-foreground">{ep.url}</code>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
