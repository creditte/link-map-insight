/**
 * Boot Trace – lightweight instrumentation for diagnosing stuck loading states.
 *
 * Logs are kept in memory AND pushed to localStorage("boot_trace") so they
 * survive a React re-render / hot-reload and can be retrieved from DevTools
 * or shown in the ?debug=boot overlay.
 */

const STORAGE_KEY = "boot_trace";
const MAX_ENTRIES = 200;
const bootStart = Date.now();

export interface TraceEntry {
  t: number;       // ms since boot
  ts: string;      // ISO timestamp
  step: string;    // e.g. "useAuth"
  label: string;   // e.g. "status → authenticated"
  data?: unknown;  // optional payload
}

// In-memory ring buffer
let entries: TraceEntry[] = [];

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota exceeded – silently drop
  }
}

export function trace(step: string, label: string, data?: unknown) {
  const entry: TraceEntry = {
    t: Date.now() - bootStart,
    ts: new Date().toISOString(),
    step,
    label,
    data: data !== undefined ? data : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);

  // Console in collapsed group for minimal noise
  console.log(`[BootTrace +${entry.t}ms] ${step}: ${label}`, data ?? "");
  persist();
}

export function getTrace(): TraceEntry[] {
  return [...entries];
}

export function clearTrace() {
  entries = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/** Restore entries from a previous page load (useful for post-crash analysis) */
export function restorePreviousTrace(): TraceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TraceEntry[];
  } catch { /* noop */ }
  return [];
}
