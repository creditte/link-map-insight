REVOKE ALL ON FUNCTION public.import_xpm_batch(uuid, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_xpm_upsert_clients(uuid, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_xpm_link_trustees(uuid, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_xpm_link_group(uuid, text, text, text[], text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_xpm_ensure_fallback_structure(uuid, timestamptz) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_stale_import_jobs(int) FROM anon, authenticated;