CREATE OR REPLACE FUNCTION public.claim_sync_job(_job_id uuid, _lease_seconds integer DEFAULT 90)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _claimed boolean := false;
BEGIN
  UPDATE public.import_logs
  SET result = jsonb_set(
        coalesce(result, '{}'::jsonb),
        '{progress,leaseUntil}',
        to_jsonb((now() + make_interval(secs => greatest(_lease_seconds, 10)))::text),
        true
      ),
      updated_at = now()
  WHERE id = _job_id
    AND status = 'processing'
    AND (
      nullif(result->'progress'->>'leaseUntil', '') IS NULL
      OR (result->'progress'->>'leaseUntil')::timestamptz < now()
    )
  RETURNING true INTO _claimed;

  RETURN coalesce(_claimed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_sync_job(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_job(uuid, integer) TO service_role;