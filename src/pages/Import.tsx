import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle, AlertCircle, Download, Info, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const SAMPLE_CSV = `Name,Entity Type,ABN,ACN,Relationship Type,Related To
"Smith Family Trust",Trust,12345678901,,"trustee","Smith Corp Pty Ltd"
"Smith Corp Pty Ltd",Company,98765432109,123456789,"director","John Smith"
"John Smith",Individual,,,,"";`;

export default function Import() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [importLogs, setImportLogs] = useState<any[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);

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

    try {
      const text = await file.text();
      const { data, error } = await supabase.functions.invoke("import-xpm", {
        body: { fileName: file.name, content: text },
      });
      if (error) throw error;
      setResult(data);
      toast({
        title: "Import complete",
        description: `${data.entitiesCreated ?? 0} entities, ${data.relationshipsCreated ?? 0} relationships processed.`,
      });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
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
    <div className="space-y-6 mb-2">
      <h1 className="text-2xl font-bold tracking-tight">Import</h1>

      {/* Step-by-step instructions */}
      <Card>
        <CardHeader className="cursor-pointer pb-3" onClick={() => setShowInstructions(!showInstructions)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">How to export from XPM</CardTitle>
            </div>
            {showInstructions ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
            <div className="flex items-center gap-2 pt-1">
              <Download className="h-4 w-4" />
              <button onClick={handleDownloadSample} className="text-primary hover:underline font-medium">
                Download sample CSV file
              </button>
              <span className="text-xs">— see the expected format before importing</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Upload area */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Upload XPM Report</CardTitle>
          <CardDescription>Upload a Client Relationships Report from XPM in CSV or XML format.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <Upload className="h-5 w-5" />
            <span className="text-sm font-medium">{file ? file.name : "Choose CSV or XML file"}</span>
            <input type="file" accept=".csv,.xml" className="hidden" onChange={handleFileChange} />
          </label>

          {!file && <p className="text-xs text-muted-foreground text-center">Select a file above to enable import.</p>}

          <Button onClick={handleImport} disabled={!file || importing} className="w-full">
            {importing ? "Importing..." : "Import"}
          </Button>

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
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {result.warnings?.length > 0 ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle className="h-5 w-5 text-primary" />
              )}
              Import Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>
                Rows parsed: <strong>{result.totalRowsParsed ?? 0}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>
                Entities created: <strong>{result.entitiesCreated ?? 0}</strong> | updated:{" "}
                <strong>{result.entitiesUpdated ?? 0}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>
                Relationships created: <strong>{result.relationshipsCreated ?? 0}</strong> | skipped:{" "}
                <strong>{result.relationshipsSkipped ?? 0}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>
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
      <Card className="mb-2">
        <CardHeader>
          <CardTitle className="text-base">Import History</CardTitle>
          <CardDescription>Previous imports for your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {importLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Records Imported</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(log.created_at), "d MMM yyyy, h:mm a")}
                    </TableCell>
                    <TableCell className="text-xs font-medium truncate max-w-[200px]">{log.file_name || "—"}</TableCell>
                    <TableCell className="text-xs">{getRecordCount(log)}</TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
