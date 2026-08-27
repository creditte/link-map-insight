CREATE OR REPLACE FUNCTION public.sync_xpm_link_groups(_tenant_id uuid, _groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g record;
  res jsonb;
  _created int := 0;
  _skipped int := 0;
  _processed int := 0;
  _errors jsonb := '[]'::jsonb;
BEGIN
  FOR g IN
    SELECT x.uuid, x.name, x.hash, x.members
    FROM jsonb_to_recordset(coalesce(_groups, '[]'::jsonb))
         AS x(uuid text, name text, hash text, members jsonb)
    WHERE coalesce(x.uuid, '') <> ''
  LOOP
    res := public.sync_xpm_link_group(
      _tenant_id,
      g.uuid,
      g.name,
      coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(g.members, '[]'::jsonb)) AS value), ARRAY[]::text[]),
      g.hash
    );
    _processed := _processed + 1;
    IF coalesce((res->>'skipped')::boolean, false) THEN
      _skipped := _skipped + 1;
    ELSIF res->>'error' IS NOT NULL THEN
      IF jsonb_array_length(_errors) < 50 THEN
        _errors := _errors || to_jsonb(format('Group "%s": %s', g.name, res->>'error'));
      END IF;
    ELSIF coalesce((res->>'structureCreated')::boolean, false) THEN
      _created := _created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'groupsProcessed', _processed,
    'structuresCreated', _created,
    'skippedUnchanged', _skipped,
    'errors', _errors
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_xpm_link_groups(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_xpm_link_groups(uuid, jsonb) TO service_role;