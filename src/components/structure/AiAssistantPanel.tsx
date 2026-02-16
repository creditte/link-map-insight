import { useState, useCallback } from "react";
import { X, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { EntityNode, RelationshipEdge } from "@/hooks/useStructureData";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

const ANALYSE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-structure`;

interface Props {
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  structureName: string;
  onClose: () => void;
}

export default function AiAssistantPanel({ entities, relationships, structureName, onClose }: Props) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setContent("");
    setHasRun(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({ title: "Not authenticated", description: "Please sign in to use AI analysis.", variant: "destructive" });
        setLoading(false);
        return;
      }

      const resp = await fetch(ANALYSE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ entities, relationships, structureName }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        toast({ title: "Analysis failed", description: err.error, variant: "destructive" });
        setLoading(false);
        return;
      }

      if (!resp.body) {
        toast({ title: "Analysis failed", description: "No response stream", variant: "destructive" });
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              accumulated += delta;
              setContent(accumulated);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              accumulated += delta;
              setContent(accumulated);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error("AI analysis error:", e);
      toast({ title: "Analysis failed", description: "Network error", variant: "destructive" });
    }

    setLoading(false);
  }, [entities, relationships, structureName, toast]);

  return (
    <div className="absolute left-0 top-0 z-10 flex h-full w-96 flex-col border-r bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">AI Structure Assistant</h3>
        </div>
        <div className="flex items-center gap-1">
          {hasRun && !loading && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={runAnalysis} title="Re-run analysis">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {!hasRun && !loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Analyse this structure</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Get an AI-generated summary of ownership, control, and potential issues.
                </p>
              </div>
              <Button onClick={runAnalysis} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Run Analysis
              </Button>
            </div>
          )}

          {loading && !content && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analysing structure...</span>
            </div>
          )}

          {content && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
