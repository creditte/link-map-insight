import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle, AlertCircle, Download, Info, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCacheInvalidation } from "@/hooks/useSharedQueries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import XeroErrorAlert from "@/components/XeroErrorAlert";
import { xeroToastPayload } from "@/lib/xeroErrors";
import { useXeroConnection } from "@/contexts/XeroConnectionContext";

const SAMPLE_CSV = `Name,Entity Type,ABN,ACN,Relationship Type,Related To
"Smith Family Trust",Trust,12345678901,,"trustee","Smith Corp Pty Ltd"
"Smith Corp Pty Ltd",Company,98765432109,123456789,"director","John Smith"
"John Smith",Individual,,,,"";`;

export default function Import() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { invalidateStructures } = useCacheInvalidation();

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [importError, setImportError] = useState<unknown>(null);
  const [progress, setProgress] = useState<{ phase: string; rowIndex: number; total: number } | null>(null);
  const [importLogs, setImportLogs] = useState<any[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);
  const { reportError: reportXeroError } = useXeroConnection();

  useEffect(() => {
    if (!user) return;
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("import_logs")
        .select("id, file_name, status, result, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setImportLogs(data);
    };
    fetchLogs();
  }, [user, result]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && (f.name.endsWith(".csv") || f.name.endsWith(".xml"))) {
      setFile(f);
      setResult(null);
    } else {
      toast({ title: "Invalid file", description: "Please select a CSV or XML file.", variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!file || !user) return;
    setImporting(true);
    setResult(null);
    setImportError(null);
    setProgress(null);

    try {
      const text = await file.text();
      const { data, error } = await supabase.functions.invoke("import-xpm", {
        body: { fileName: file.name, content: text },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const jobId: string | undefined = data?.jobId;
      if (!jobId) {
        // Legacy synchronous response
        setResult(data);
        toast({
          title: "Import complete",
          description: `${data.entitiesCreated ?? 0} entities, ${data.relationshipsCreated ?? 0} relationships processed.`,
        });
        return;
      }

      toast({
        title: "Import started",
        description: "Large files are processed in the background — this page will update automatically.",
      });

      const final = await pollJob(jobId);
      if (final.status === "failed") {
        throw new Error(final.result?.error || "The import failed while processing.");
      }
      setResult(final.result);
      setProgress(null);
      // Import created structures/entities — refresh cached lists and counts.
      invalidateStructures();
      toast({
        title: "Import complete",
        description: `${final.result?.entitiesCreated ?? 0} entities, ${final.result?.relationshipsCreated ?? 0} relationships processed.`,
      });
    } catch (err: unknown) {
      setImportError(err);
      reportXeroError(err);
      const payload = xeroToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  /** Poll the import_logs row until the background job finishes. */
  const pollJob = async (jobId: string): Promise<{ status: string; result: any }> => {
    const started = Date.now();
    const TIMEOUT_MS = 20 * 60 * 1000;
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data } = await supabase
        .from("import_logs")
        .select("status, result")
        .eq("id", jobId)
        .maybeSingle();
      if (!data) continue;
      const res = data.result as any;
      if (data.status === "processing") {
        setProgress({
          phase: res?.phase ?? "entities",
          rowIndex: res?.rowIndex ?? 0,
          total: res?.totalRowsParsed ?? 0,
        });
        continue;
      }
      return { status: data.status, result: res };
    }
    throw new Error("The import is taking longer than expected. Check Import History for the final result.");
  };


  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-import.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-primary/15 text-primary border-primary/20">
            Completed
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "processing":
        return <Badge variant="secondary">Processing</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRecordCount = (log: any) => {
    if (!log.result) return "—";
    const r = log.result as any;
    const entities = (r.entitiesCreated ?? 0) + (r.entitiesUpdated ?? 0);
    const rels = r.relationshipsCreated ?? 0;
    return `${entities} entities, ${rels} relationships`;
  };

  return (
    <div className="space-y-4 sm:space-y-6 mb-2 min-w-0">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Import</h1>

      {/* Step-by-step instructions */}
      <Card>
        <CardHeader className="cursor-pointer pb-3" onClick={() => setShowInstructions(!showInstructions)}>
          <div className="flex items-start justify-between gap-3 sm:items-center">
            <div className="flex min-w-0 items-start gap-2 sm:items-center">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
              <CardTitle className="text-base leading-snug">How to export from XPM</CardTitle>
            </div>
            {showInstructions ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {showInstructions && (
          <CardContent className="pt-0 space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                In Xero Practice Manager, navigate to <strong className="text-foreground">Business → Reports</strong>.
              </li>
              <li>
                Find and open the <strong className="text-foreground">Client Relationships Report</strong>.
              </li>
              <li>Set the report filters as needed (e.g. all clients or a specific group).</li>
              <li>
                Click <strong className="text-foreground">Export</strong> and choose{" "}
                <strong className="text-foreground">CSV</strong> or <strong className="text-foreground">XML</strong>{" "}
                format.
              </li>
              <li>Save the file to your computer, then upload it below.</li>
            </ol>
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0" />
                <button type="button" onClick={handleDownloadSample} className="text-left text-primary hover:underline font-medium">
                  Download sample CSV file
                </button>
              </div>
              <span className="text-xs sm:pl-0">See the expected format before importing.</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Upload area */}
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Upload XPM Report</CardTitle>
          <CardDescription>Upload a Client Relationships Report from XPM in CSV or XML format.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-4 text-muted-foreground transition-colors hover:border-primary hover:text-foreground sm:flex-row sm:p-8">
            <Upload className="h-5 w-5 shrink-0" />
            <span className="max-w-full min-w-0 break-words text-center text-sm font-medium sm:text-left">
              {file ? file.name : "Choose CSV or XML file"}
            </span>
            <input type="file" accept=".csv,.xml" className="hidden" onChange={handleFileChange} />
          </label>

          {!file && <p className="text-xs text-muted-foreground text-center">Select a file above to enable import.</p>}

          <Button onClick={handleImport} disabled={!file || importing} className="w-full">
            {importing ? "Importing..." : "Import"}
          </Button>

          {importing && progress && (
            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-foreground">
                {progress.phase === "entities"
                  ? "Creating entities…"
                  : progress.phase === "structures"
                    ? "Building structures…"
                    : "Linking relationships…"}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${progress.total ? Math.min(100, Math.round((progress.rowIndex / progress.total) * 100)) : 5}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.rowIndex} of {progress.total} rows processed. Large files continue in the background.
              </p>
            </div>
          )}


          {importError && (
            <XeroErrorAlert
              error={importError}
              onRetry={handleImport}
              retrying={importing}
            />
          )}

          {/* Post-import expectations */}
          <div className="rounded-md bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">What happens after import?</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
              <li>
                Existing entities are <strong>matched by name and type</strong> — matching records are updated, not
                duplicated.
              </li>
              <li>
                New entities and relationships are <strong>created automatically</strong>.
              </li>
              <li>A new structure is created for each client group found in the file.</li>
              <li>
                You can review and merge any potential duplicates from the <strong>Review</strong> page.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Import result */}
      {result && (
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-start gap-2 text-base sm:items-center">
              {result.warnings?.length > 0 ? (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive sm:mt-0" />
              ) : (
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary sm:mt-0" />
              )}
              <span className="leading-snug">Import Results</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">
                Rows parsed: <strong>{result.totalRowsParsed ?? 0}</strong>
              </span>
            </div>
            <div className="flex gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">
                Entities created: <strong>{result.entitiesCreated ?? 0}</strong>
                <span className="text-muted-foreground"> · </span>
                updated: <strong>{result.entitiesUpdated ?? 0}</strong>
              </span>
            </div>
            <div className="flex gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">
                Relationships created: <strong>{result.relationshipsCreated ?? 0}</strong>
                <span className="text-muted-foreground"> · </span>
                skipped: <strong>{result.relationshipsSkipped ?? 0}</strong>
              </span>
            </div>
            <div className="flex gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">
                Structures created: <strong>{result.structuresCreated ?? 0}</strong>
              </span>
            </div>
            {result.warnings?.length > 0 && (
              <div className="mt-3 space-y-1 rounded-md bg-destructive/10 p-3">
                <p className="font-medium text-destructive">Warnings:</p>
                {result.warnings.map((w: string, i: number) => (
                  <p key={i} className="text-xs text-destructive">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import history */}
      <Card className="mb-2 min-w-0">
        <CardHeader>
          <CardTitle className="text-base">Import History</CardTitle>
          <CardDescription>Previous imports for your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 p-3 pt-0 sm:p-6 sm:pt-0">
          {importLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No imports yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto rounded-md border sm:mx-0">
              <Table className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="min-w-[10rem]">Records Imported</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap align-top">
                        {format(new Date(log.created_at), "d MMM yyyy, h:mm a")}
                      </TableCell>
                      <TableCell className="max-w-[10rem] text-xs font-medium break-words align-top sm:max-w-[14rem]">
                        {log.file_name || "—"}
                      </TableCell>
                      <TableCell className="max-w-[14rem] text-xs break-words align-top">
                        {getRecordCount(log)}
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap">{getStatusBadge(log.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
