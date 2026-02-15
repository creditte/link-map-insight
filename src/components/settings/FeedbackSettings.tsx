import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface FeedbackRow {
  id: string;
  user_id: string;
  page: string | null;
  structure_id: string | null;
  message: string;
  created_at: string;
  status: string;
}

const STATUS_OPTIONS = ["new", "reviewed", "actioned"] as const;

function statusVariant(s: string): "default" | "secondary" | "outline" {
  if (s === "new") return "default";
  if (s === "reviewed") return "secondary";
  return "outline";
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
        <p className="text-sm text-muted-foreground">Loading feedback…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead className="w-[100px]">Page</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-[130px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">
                    {r.page ?? "—"}
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
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
