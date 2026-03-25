import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

interface FeedbackRow {
  id: string;
  user_id: string;
  page: string | null;
  structure_id: string | null;
  message: string;
  created_at: string;
  status: string;
}

const STATUS_OPTIONS = ["new", "unread", "reviewed", "actioned"] as const;

function statusVariant(s: string): "default" | "secondary" | "outline" {
  if (s === "new" || s === "unread") return "default";
  if (s === "reviewed") return "secondary";
  return "outline";
}

function formatPageLabel(page: string | null): { label: string; full: string | null } {
  if (!page) return { label: "—", full: null };
  if (page.startsWith("/structures/")) return { label: "Structure view", full: page };
  if (page.length > 30) return { label: page.slice(0, 28) + "…", full: page };
  return { label: page, full: null };
}

export default function FeedbackSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback")
      .select("id, user_id, page, structure_id, message, created_at, status")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      toast({ title: "Failed to load feedback", description: error.message, variant: "destructive" });
    }
    setRows(data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    if (user?.id) load();
  }, [user?.id, load]);

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from("feedback")
      .update({ status: newStatus })
      .eq("id", id);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    toast({ title: "Status updated" });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Feedback</h2>
        <p className="text-sm text-muted-foreground">
          Review feedback submitted by your team.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border p-3">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead className="w-[120px]">Page</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-[130px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isUnread = r.status === "new" || r.status === "unread";
                const pageInfo = formatPageLabel(r.page);
                return (
                  <TableRow key={r.id} className={isUnread ? "bg-primary/[0.03]" : ""}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                        {format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {pageInfo.full ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">
                              {pageInfo.label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs font-mono break-all">{pageInfo.full}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        pageInfo.label
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-[300px]">
                      <p className="line-clamp-2">{r.message}</p>
                    </TableCell>
                    <TableCell>
                      <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                        <SelectTrigger className="h-8 w-[110px]">
                          <Badge variant={statusVariant(r.status)} className="text-[10px]">
                            {r.status}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
