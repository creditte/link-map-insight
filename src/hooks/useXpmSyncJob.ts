import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { xeroToastPayload } from "@/lib/xeroErrors";

/** Job rows written by the sync-xpm edge function. */
const JOB_FILE_NAME = "xpm-sync-3.1";
/** Poll interval while a sync is running. One narrow row read per tick. */
const POLL_MS = 4000;

export type XpmSyncPhase = "clients" | "groups" | "staff" | "done";

export interface XpmSyncJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  updatedAt: string;
  phase: XpmSyncPhase;
  clientsFetched: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  groupsCreated: number;
  groupsProcessed: number;
  groupsTotal: number;
  groupsSkippedUnchanged: number;
  staffFetched: number;
  error?: string;
}

function mapJob(row: any): XpmSyncJob {
  const r = row.result ?? {};
  return {
    id: row.id,
    status: row.status,
    updatedAt: row.updated_at,
    phase: (r.phase as XpmSyncPhase) ?? "clients",
    clientsFetched: r.clientsFetched ?? 0,
    entitiesCreated: r.entitiesCreated ?? 0,
    entitiesUpdated: r.entitiesUpdated ?? 0,
    relationshipsCreated: r.relationshipsCreated ?? 0,
    groupsCreated: r.groupsCreated ?? 0,
    groupsProcessed: r.progress?.groupsProcessed ?? r.groupsProcessed ?? 0,
    groupsTotal: r.progress?.groupsTotal ?? r.groupsFound ?? 0,
    groupsSkippedUnchanged: r.groupsSkippedUnchanged ?? 0,
    staffFetched: r.staffFetched ?? 0,
    error: r.error,
  };
}

/** Human-readable description of where the sync currently is. */
export function xpmSyncLabel(job: XpmSyncJob | null): string {
  if (!job) return "";
  if (job.status === "failed") return job.error ?? "Sync failed";
  if (job.status === "completed") return "Sync complete";
  switch (job.phase) {
    case "clients":
      return `Reading clients from XPM — ${job.clientsFetched} so far`;
    case "groups":
      return job.groupsTotal > 0
        ? `Building client groups — ${job.groupsProcessed} of ${job.groupsTotal}`
        : "Loading client groups from XPM";
    case "staff":
      return "Finalising";
    default:
      return "Syncing";
  }
}

/** Rough completion percentage; the group phase dominates a real sync. */
export function xpmSyncPercent(job: XpmSyncJob | null): number {
  if (!job) return 0;
  if (job.status === "completed") return 100;
  if (job.phase === "clients") return 5;
  if (job.phase === "staff") return 97;
  if (job.groupsTotal > 0) {
    return Math.min(95, 10 + Math.round((job.groupsProcessed / job.groupsTotal) * 85));
  }
  return 10;
}

/**
 * Tracks the XPM sync as a background job instead of a fire-and-forget request.
 *
 * The sync runs across several edge-function executions, so the UI follows the
 * job row: it polls only while a sync is actually running, stops as soon as the
 * job reaches a terminal state, and reports completion from the database rather
 * than from the request that started it.
 */
export function useXpmSyncJob(options?: { onFinished?: () => void }) {
  const { toast } = useToast();
  const [job, setJob] = useState<XpmSyncJob | null>(null);
  const [starting, setStarting] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const onFinished = options?.onFinished;

  const fetchJob = useCallback(async () => {
    const { data, error } = await supabase
      .from("import_logs")
      .select("id, status, updated_at, result")
      .eq("file_name", JOB_FILE_NAME)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const mapped = mapJob(data);
    setJob(mapped);
    return mapped;
  }, []);

  // Pick up a sync that is already running (started on another tab or device).
  useEffect(() => {
    fetchJob().then((j) => {
      lastStatus.current = j?.status ?? null;
    });
  }, [fetchJob]);

  const running = job?.status === "processing";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const next = await fetchJob();
      if (!next || next.status === "processing") return;

      if (lastStatus.current === "processing") {
        if (next.status === "completed") {
          const parts = [
            `${next.clientsFetched} clients`,
            `${next.entitiesCreated} entities created`,
            `${next.entitiesUpdated} updated`,
          ];
          if (next.relationshipsCreated > 0) parts.push(`${next.relationshipsCreated} relationships`);
          if (next.groupsCreated > 0) parts.push(`${next.groupsCreated} diagrams created`);
          if (next.groupsSkippedUnchanged > 0) parts.push(`${next.groupsSkippedUnchanged} unchanged`);
          toast({ title: "XPM sync complete", description: parts.join(", ") + "." });
        } else if (next.status === "failed") {
          toast({
            title: "XPM sync failed",
            description: next.error ?? "The sync stopped before finishing. Please try again.",
            variant: "destructive",
          });
        }
        onFinished?.();
      }
      lastStatus.current = next.status;
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, fetchJob, toast, onFinished]);

  useEffect(() => {
    if (job?.status) lastStatus.current = job.status;
  }, [job?.status]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-xpm");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: data?.alreadyRunning ? "XPM sync already running" : "XPM sync started",
        description: "Progress is shown here — you can keep working while it runs.",
      });
      lastStatus.current = "processing";
      await fetchJob();
    } catch (err) {
      const payload = xeroToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
      throw err;
    } finally {
      setStarting(false);
    }
  }, [fetchJob, toast]);

  return {
    job,
    running: running || starting,
    starting,
    label: xpmSyncLabel(job),
    percent: xpmSyncPercent(job),
    start,
    refresh: fetchJob,
  };
}
