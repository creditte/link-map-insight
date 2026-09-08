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
import { useBilling } from "@/hooks/useBilling";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const [stage, setStage] = useState<"idle" | "uploading" | "preparing" | "importing" | "finishing">("idle");
  const [percent, setPercent] = useState(0);
  const [records, setRecords] = useState<{ done: number; total: number } | null>(null);
  const [importLogs, setImportLogs] = useState<any[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);
  const { reportError: reportXeroError } = useXeroConnection();
  const { billing } = useBilling();

  const structureLimit = billing?.diagram_limit ?? null;
  const structureCount = billing?.diagram_count ?? null;
  const limitReached =
    structureLimit !== null && structureCount !== null && structureCount >= structureLimit;
  const freeSlots =
    structureLimit !== null && structureCount !== null
      ? Math.max(0, structureLimit - structureCount)
      : null;

  const [analysing, setAnalysing] = useState(false);
  const [preflight, setPreflight] = useState<{
    groups: number;
    newGroups: number;
    existingGroups: number;
    freeSlots: number | null;
    fits: boolean;
  } | null>(null);

  /** Pull the client-group names out of an XPM CSV/XML export, client-side. */
  const extractGroupNames = (text: string, isXml: boolean): Set<string> => {
    const names = new Set<string>();
    const push = (raw: string) => {
      for (const g of raw.split(";").map((s) => s.trim()).filter(Boolean)) names.add(g);
    };
    if (isXml) {
      const re = /<Client-Groups>([\s\S]*?)<\/Client-Groups>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push(m[1].trim());
      return names;
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return names;
    const splitLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
        } else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const header = splitLine(lines[0]).map((h) => h.replace(/^"+|"+$/g, "").trim().toLowerCase());
    const gi = header.findIndex((h) => h.includes("group"));
    if (gi < 0) return names;
    for (let i = 1; i < lines.length; i++) {
      const cols = splitLine(lines[i]).map((c) => c.replace(/^"+|"+$/g, "").trim());
      if (cols[gi]) push(cols[gi]);
    }
    return names;
  };

  /** Decide up front whether the file's groups fit in the remaining slots. */
  const analyseFile = async (f: File) => {
    setAnalysing(true);
    setPreflight(null);
    try {
      const text = await f.text();
      const groups = extractGroupNames(text, f.name.toLowerCase().endsWith(".xml"));
      const { data: existing } = await supabase
        .from("structures")
        .select("name")
        .is("deleted_at", null);
      const existingNames = new Set((existing ?? []).map((s: any) => String(s.name)));
      let newGroups = 0;
      groups.forEach((g) => {
        if (!existingNames.has(g)) newGroups++;
      });
      setPreflight({
        groups: groups.size,
        newGroups,
        existingGroups: groups.size - newGroups,
        freeSlots,
        fits: freeSlots === null || newGroups <= freeSlots,
      });
    } catch {
      setPreflight(null);
    } finally {
      setAnalysing(false);
    }
  };

  /** Monotonic progress — never let the bar jump backwards. */
  const advance = (next: number) => setPercent((prev) => Math.max(prev, Math.min(99, next)));

  const STAGE_LABEL: Record<string, string> = {
    uploading: "Uploading file…",
    preparing: "Preparing data…",
    importing: "Importing records…",
    finishing: "Almost done…",
  };


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
      setImportError(null);
      void analyseFile(f);
    } else {
      toast({ title: "Invalid file", description: "Please select a CSV or XML file.", variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!file || !user) return;
    if (limitReached) {
      toast({
        title: "Structure limit reached",
        description: `You already have ${structureCount} of ${structureLimit} structures. Delete a structure or upgrade your subscription before importing.`,
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    setResult(null);
    setImportError(null);
    setRecords(null);
    setPercent(0);
    setStage("uploading");

    // Gentle creep so the bar always feels alive between server updates.
    const creep = setInterval(() => setPercent((prev) => (prev < 95 ? prev + 0.4 : prev)), 400);

    try {
      const text = await file.text();
      advance(8);
      const { data, error } = await supabase.functions.invoke("import-xpm", {
        body: { fileName: file.name, content: text },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setStage("preparing");
      advance(15);

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

      if (data?.totalRowsParsed) setRecords({ done: 0, total: data.totalRowsParsed });

      const final = await pollJob(jobId);
      if (final.status === "failed") {
        throw new Error(final.result?.error || "The import failed while processing.");
      }
      setStage("finishing");
      setPercent(100);
      setResult(final.result);
      // Import created structures/entities — refresh cached lists and counts.
      invalidateStructures();
      const limited = (final.result?.structuresSkippedLimit ?? 0) > 0;
      toast({
        title: limited ? "Import completed with limitations" : "Import complete",
        description: limited
          ? `${final.result?.entitiesCreated ?? 0} entities imported. ${final.result.structuresSkippedLimit} group(s) skipped — structure limit reached.`
          : `${final.result?.entitiesCreated ?? 0} entities, ${final.result?.relationshipsCreated ?? 0} relationships processed.`,
      });

    } catch (err: unknown) {
      setImportError(err);
      reportXeroError(err);
      const payload = xeroToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
    } finally {
      clearInterval(creep);
      setImporting(false);
      setStage("idle");
    }
  };

  /** Poll the import job until it finishes. Server batching stays invisible. */
  const pollJob = async (jobId: string): Promise<{ status: string; result: any }> => {
    const started = Date.now();
    const TIMEOUT_MS = 20 * 60 * 1000;
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 900));
      const { data } = await supabase
        .from("import_logs")
        .select("status, result")
        .eq("id", jobId)
        .maybeSingle();
      if (!data) continue;
      const res = data.result as any;
      if (data.status === "processing") {
        const total = Number(res?.totalRowsParsed ?? 0);
        const done = Number(res?.rowIndex ?? 0);
        if (total > 0) {
          setRecords({ done, total });
          // Map row progress into the 15–97% band so the bar never resets.
          advance(15 + (done / total) * 82);
          setStage(done >= total ? "finishing" : "importing");
        } else {
          setStage("importing");
        }
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
          {limitReached && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Structure limit reached</AlertTitle>
              <AlertDescription>
                You're using all {structureLimit} structures included in your plan. Delete or archive
                a structure, or upgrade your subscription, before importing another XPM report.
              </AlertDescription>
            </Alert>
          )}
          <label className="flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-4 text-muted-foreground transition-colors hover:border-primary hover:text-foreground sm:flex-row sm:p-8">
            <Upload className="h-5 w-5 shrink-0" />
            <span className="max-w-full min-w-0 break-words text-center text-sm font-medium sm:text-left">
              {file ? file.name : "Choose CSV or XML file"}
            </span>
            <input type="file" accept=".csv,.xml" className="hidden" onChange={handleFileChange} />
          </label>

          {!file && <p className="text-xs text-muted-foreground text-center">Select a file above to enable import.</p>}

          <Button onClick={handleImport} disabled={!file || importing || limitReached} className="w-full">
            {importing ? "Importing..." : "Import"}
          </Button>

          {importing && (
            <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">{STAGE_LABEL[stage] ?? "Importing records…"}</p>
                <span className="text-xs tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(3, percent)}%` }}
                />
              </div>
              {records && records.total > 0 && (
                <p className="text-xs text-muted-foreground">
                  {records.done.toLocaleString()} of {records.total.toLocaleString()} records
                </p>
              )}
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
              {result.warnings?.length > 0 || (result.structuresSkippedLimit ?? 0) > 0 ? (
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
            {(result.structuresSkippedLimit ?? 0) > 0 && (
              <div className="mt-3 space-y-1 rounded-md bg-destructive/10 p-3">
                <p className="font-medium text-destructive">Import completed with limitations</p>
                <p className="text-xs text-destructive">
                  {result.structuresSkippedLimit} client group
                  {result.structuresSkippedLimit === 1 ? "" : "s"} could not be created because your
                  workspace has reached its{" "}
                  {result.structureLimit ? `${result.structureLimit}-structure` : "structure"} limit
                  {(result.rowsSkippedLimit ?? 0) > 0
                    ? `, affecting ${result.rowsSkippedLimit.toLocaleString()} record${result.rowsSkippedLimit === 1 ? "" : "s"}`
                    : ""}
                  . Entities and relationships were still imported — archive or delete structures, or
                  upgrade your plan, then re-run this import to group them.
                </p>
              </div>
            )}
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
