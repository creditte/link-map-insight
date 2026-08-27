// Temporary perf-audit runner: kicks a sync job continuation. Deleted after the audit.
Deno.serve(async (req) => {
  const { job_id } = await req.json().catch(() => ({ job_id: null }));
  if (!job_id) return new Response(JSON.stringify({ error: "job_id required" }), { status: 400 });
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-xpm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ continue_job: job_id }),
  });
  return new Response(JSON.stringify({ status: res.status, body: await res.text() }), {
    headers: { "Content-Type": "application/json" },
  });
});
