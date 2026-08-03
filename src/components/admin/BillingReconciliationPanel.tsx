import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, PlayCircle } from "lucide-react";

interface ReconcileSummary {
  mode: string;
  run_at: string;
  run_by: string;
  tenants_scanned: number;
  tenants_in_sync: number;
  tenants_needing_changes: number;
  tenants_updated: number;
  issues_count: number;
}

interface ReconcileTenant {
  tenant_id: string;
  firm_name: string | null;
  subscription_id: string | null;
  status: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  notes: string[];
}

interface ReconcileResponse {
  summary: ReconcileSummary;
  tenants: ReconcileTenant[];
  issues: Array<Record<string, unknown>>;
}

const fmt = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

export default function BillingReconciliationPanel() {
  const { toast } = useToast();
  const [running, setRunning] = useState<"preview" | "apply" | null>(null);
  const [result, setResult] = useState<ReconcileResponse | null>(null);

  const run = async (apply: boolean) => {
    setRunning(apply ? "apply" : "preview");
    try {
      const { data, error } = await supabase.functions.invoke("reconcile-billing", {
        body: { apply },
      });
      if (error) throw error;
      setResult(data as ReconcileResponse);
      const s = (data as ReconcileResponse).summary;
      toast({
        title: apply ? "Reconciliation applied" : "Reconciliation preview ready",
        description: apply
          ? `${s.tenants_updated} of ${s.tenants_scanned} firms updated.`
          : `${s.tenants_needing_changes} of ${s.tenants_scanned} firms need changes.`,
      });
    } catch (e: any) {
      const detail = e?.context?.body || e?.message || "Reconciliation failed";
      toast({ title: "Reconciliation failed", description: String(detail), variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  const summary = result?.summary;
  const pending = result?.tenants ?? [];

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Billing reconciliation
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Compares each firm's stored billing state against the payment provider, backfills
              missing billing periods, expires stale trials and normalises plan selections. Preview
              first — nothing is written until you apply.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => run(false)} disabled={!!running}>
              {running === "preview" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Preview
            </Button>
            <Button
              size="sm"
              onClick={() => run(true)}
              disabled={!!running || !summary || summary.tenants_needing_changes === 0}
            >
              {running === "apply" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Apply changes
            </Button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Scanned", value: summary.tenants_scanned },
              { label: "In sync", value: summary.tenants_in_sync },
              { label: "Need changes", value: summary.tenants_needing_changes },
              { label: "Updated", value: summary.tenants_updated },
              { label: "Issues", value: summary.issues_count },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-medium tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {summary && pending.length === 0 && (
          <p className="text-xs text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All firms are consistent with the payment provider.
          </p>
        )}

        {pending.length > 0 && (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {pending.map((t) => (
              <div key={t.tenant_id} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{t.firm_name || t.tenant_id}</p>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      t.status === "applied"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : t.status === "failed"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {Object.entries(t.changes).map(([field, c]) => (
                    <li key={field} className="text-xs text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">{field}</span>: {fmt(c.from)} →{" "}
                      {fmt(c.to)}
                    </li>
                  ))}
                </ul>
                {t.notes.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {t.notes.join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
