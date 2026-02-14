import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Import() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);

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
      toast({ title: "Import complete", description: `${data.entitiesCreated ?? 0} entities, ${data.relationshipsCreated ?? 0} relationships processed.` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Import</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Upload XPM Report</CardTitle>
          <CardDescription>
            Upload a Client Relationships Report from XPM in CSV or XML format.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <Upload className="h-5 w-5" />
            <span className="text-sm font-medium">{file ? file.name : "Choose CSV or XML file"}</span>
            <input type="file" accept=".csv,.xml" className="hidden" onChange={handleFileChange} />
          </label>
          <Button onClick={handleImport} disabled={!file || importing} className="w-full">
            {importing ? "Importing..." : "Import"}
          </Button>
        </CardContent>
      </Card>

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
              <span>Rows parsed: <strong>{result.totalRowsParsed ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>Entities created: <strong>{result.entitiesCreated ?? 0}</strong> | updated: <strong>{result.entitiesUpdated ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>Relationships created: <strong>{result.relationshipsCreated ?? 0}</strong> | skipped: <strong>{result.relationshipsSkipped ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>Structures created: <strong>{result.structuresCreated ?? 0}</strong></span>
            </div>
            {result.warnings?.length > 0 && (
              <div className="mt-3 space-y-1 rounded-md bg-destructive/10 p-3">
                <p className="font-medium text-destructive">Warnings:</p>
                {result.warnings.map((w: string, i: number) => (
                  <p key={i} className="text-xs text-destructive">{w}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
