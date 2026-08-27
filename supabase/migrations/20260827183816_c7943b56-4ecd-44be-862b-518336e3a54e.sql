-- Set-based mirror of validate_relationship_rules, so bulk inserts can filter
-- invalid rows up front instead of raising once per row.
CREATE OR REPLACE FUNCTION public.rel_direction_valid(_rtype text, _from_type text, _to_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _from_type IS NULL OR _to_type IS NULL THEN true
    WHEN _rtype = 'director' THEN _from_type = 'Individual' AND _to_type = 'Company'
    WHEN _rtype = 'shareholder' THEN _to_type = 'Company'
      AND (_from_type IN ('Individual','Company','smsf','trust_unit','Trust','trust_discretionary','trust_family'))
    WHEN _rtype = 'unit_holder' THEN _to_type = 'trust_unit'
      AND (_from_type IN ('Individual','Company','smsf','trust_unit','Trust','trust_discretionary','trust_family'))
    WHEN _rtype = 'trustee' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate','trust_family','smsf')
    WHEN _rtype = 'beneficiary' AND _to_type = 'trust_bare' THEN _from_type IN ('Individual','Company','smsf')
    WHEN _rtype = 'beneficiary' THEN
      (_from_type IN ('Individual','Company','smsf','Trust','trust_discretionary','trust_family'))
      AND _to_type IN ('Trust','trust_discretionary','trust_family','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate')
    WHEN _rtype = 'member' THEN
      (_from_type IN ('Individual','Company','smsf','Trust','trust_discretionary','trust_family'))
      AND _to_type IN ('trust_unit','smsf')
    WHEN _rtype = 'appointer' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_family','trust_hybrid',
                       'trust_bare','trust_testamentary','trust_deceased_estate')
    WHEN _rtype = 'settlor' THEN _from_type IN ('Individual','Company')
      AND _to_type IN ('Trust','trust_discretionary','trust_unit','trust_hybrid','trust_bare',
                       'trust_testamentary','trust_deceased_estate','trust_family')
    WHEN _rtype = 'partner' THEN _from_type IN ('Individual','Company') AND _to_type IN ('Individual','Company')
    WHEN _rtype IN ('spouse','parent','child') THEN _from_type = 'Individual' AND _to_type = 'Individual'
    ELSE true
  END;
$$;

GRANT EXECUTE ON FUNCTION public.rel_direction_valid(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_xpm_upsert_clients(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _ent_created int := 0;
  _ent_updated int := 0;
  _rel_created int := 0;
  _rel_skipped int := 0;
  _rel_flipped int := 0;
  _warnings jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE _c (
    uuid text PRIMARY KEY,
    name text,
    entity_type text,
    abn text,
    acn text,
    is_trustee boolean DEFAULT false,
    entity_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _c (uuid, name, entity_type, abn, acn, is_trustee)
  SELECT x.uuid, x.name, coalesce(nullif(x.entity_type, ''), 'Unclassified'),
         nullif(x.abn, ''), nullif(x.acn, ''), coalesce(x.is_trustee, false)
  FROM jsonb_to_recordset(coalesce(_payload->'clients', '[]'::jsonb))
       AS x(uuid text, name text, entity_type text, abn text, acn text, is_trustee boolean)
  WHERE coalesce(x.uuid, '') <> '' AND coalesce(x.name, '') <> ''
  ON CONFLICT (uuid) DO NOTHING;

  INSERT INTO _c (uuid, name, entity_type)
  SELECT x.uuid, x.name, 'Unclassified'
  FROM jsonb_to_recordset(coalesce(_payload->'related', '[]'::jsonb)) AS x(uuid text, name text)
  WHERE coalesce(x.uuid, '') <> '' AND coalesce(x.name, '') <> ''
  ON CONFLICT (uuid) DO NOTHING;

  UPDATE _c c SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL AND e.xpm_uuid = c.uuid;

  UPDATE _c c SET entity_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.entities
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
    ORDER BY name, created_at
  ) e
  WHERE c.entity_id IS NULL AND e.name = c.name;

  WITH upd AS (
    UPDATE public.entities e
    SET entity_type = CASE
          WHEN c.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified'
          THEN c.entity_type::entity_type ELSE e.entity_type END,
        xpm_uuid = coalesce(e.xpm_uuid, c.uuid),
        abn = coalesce(e.abn, c.abn),
        acn = coalesce(e.acn, c.acn),
        is_trustee_company = e.is_trustee_company OR c.is_trustee,
        source = 'imported'
    FROM _c c
    WHERE c.entity_id = e.id
      AND (
        (c.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified')
        OR e.xpm_uuid IS NULL
        OR (c.abn IS NOT NULL AND e.abn IS NULL)
        OR (c.acn IS NOT NULL AND e.acn IS NULL)
        OR (c.is_trustee AND NOT e.is_trustee_company)
      )
    RETURNING 1
  )
  SELECT count(*) INTO _ent_updated FROM upd;

  SELECT count(*) INTO _ent_created FROM _c WHERE entity_id IS NULL;

  WITH ins AS (
    INSERT INTO public.entities
      (tenant_id, name, xpm_uuid, entity_type, abn, acn, is_trustee_company, source)
    SELECT _tenant_id, c.name, c.uuid, c.entity_type::entity_type, c.abn, c.acn, c.is_trustee, 'imported'
    FROM _c c WHERE c.entity_id IS NULL
    RETURNING id, xpm_uuid
  )
  UPDATE _c c SET entity_id = ins.id FROM ins WHERE ins.xpm_uuid = c.uuid;

  CREATE TEMP TABLE _sr (
    rtype text,
    from_uuid text,
    to_uuid text,
    from_id uuid,
    to_id uuid,
    from_type text,
    to_type text
  ) ON COMMIT DROP;

  INSERT INTO _sr (rtype, from_uuid, to_uuid)
  SELECT x.type, x.from_uuid, x.to_uuid
  FROM jsonb_to_recordset(coalesce(_payload->'rels', '[]'::jsonb))
       AS x(type text, from_uuid text, to_uuid text)
  WHERE coalesce(x.type, '') <> '';

  UPDATE _sr s SET from_id = c.entity_id FROM _c c WHERE c.uuid = s.from_uuid;
  UPDATE _sr s SET to_id = c.entity_id FROM _c c WHERE c.uuid = s.to_uuid;

  SELECT count(*) INTO _rel_skipped FROM _sr WHERE from_id IS NULL OR to_id IS NULL;
  DELETE FROM _sr WHERE from_id IS NULL OR to_id IS NULL;

  -- Resolve entity types once, set-based, for the direction rules below.
  UPDATE _sr s SET from_type = e.entity_type::text FROM public.entities e WHERE e.id = s.from_id;
  UPDATE _sr s SET to_type = e.entity_type::text FROM public.entities e WHERE e.id = s.to_id;

  -- XPM reports a relationship from whichever client record it is stored on, so
  -- flip the pair when only the opposite orientation satisfies the rules.
  WITH flipped AS (
    UPDATE _sr s
    SET from_id = s.to_id, to_id = s.from_id,
        from_type = s.to_type, to_type = s.from_type
    WHERE NOT public.rel_direction_valid(s.rtype, s.from_type, s.to_type)
      AND public.rel_direction_valid(s.rtype, s.to_type, s.from_type)
    RETURNING 1
  )
  SELECT count(*) INTO _rel_flipped FROM flipped;

  UPDATE _sr SET from_id = to_id, to_id = from_id
  WHERE rtype IN ('spouse', 'partner') AND from_id > to_id;

  -- Anything still invalid can never be inserted; drop it in bulk rather than
  -- letting the trigger raise once per row.
  WITH invalid AS (
    DELETE FROM _sr s
    WHERE NOT public.rel_direction_valid(s.rtype, s.from_type, s.to_type)
    RETURNING s.rtype
  )
  SELECT _rel_skipped + count(*),
         _warnings || coalesce(
           jsonb_agg(DISTINCT format('%s: %s link(s) from Xero did not match Strukcha''s relationship rules and were skipped', rtype, cnt)),
           '[]'::jsonb)
    INTO _rel_skipped, _warnings
  FROM (SELECT rtype, count(*) AS cnt FROM invalid GROUP BY rtype) g;

  DELETE FROM _sr s
  USING public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = s.from_id AND e.to_entity_id = s.to_id
    AND e.relationship_type::text = s.rtype;

  WITH todo AS (
    SELECT DISTINCT from_id, to_id, rtype FROM _sr
  ), ins AS (
    INSERT INTO public.relationships
      (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
    SELECT _tenant_id, t.from_id, t.to_id, t.rtype::relationship_type, 'imported', 'imported'
    FROM todo t
    RETURNING id
  )
  SELECT count(*) INTO _rel_created FROM ins;

  RETURN jsonb_build_object(
    'entitiesCreated', _ent_created,
    'entitiesUpdated', _ent_updated,
    'relationshipsCreated', _rel_created,
    'relationshipsSkipped', _rel_skipped,
    'relationshipsReoriented', _rel_flipped,
    'warnings', _warnings
  );
END;
$function$;