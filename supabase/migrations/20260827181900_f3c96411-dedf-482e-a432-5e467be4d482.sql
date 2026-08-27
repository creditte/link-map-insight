CREATE OR REPLACE FUNCTION public.import_xpm_batch(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _limit int := 0;
  _used int := 0;
  _capacity bigint := 0;
  _enforce boolean := public.is_billing_enforcement_enabled();
  _ent_created int := 0;
  _ent_updated int := 0;
  _struct_created int := 0;
  _struct_skipped int := 0;
  _rel_created int := 0;
  _rel_skipped int := 0;
  _warnings jsonb := '[]'::jsonb;
  _sid uuid;
  _rid uuid;
  rec record;
BEGIN
  CREATE TEMP TABLE _w (
    name text PRIMARY KEY,
    uuid text,
    entity_type text,
    entity_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _w (name, uuid, entity_type)
  SELECT x.name, nullif(x.uuid, ''), coalesce(nullif(x.entity_type, ''), 'Unclassified')
  FROM jsonb_to_recordset(coalesce(_payload->'entities', '[]'::jsonb))
       AS x(name text, uuid text, entity_type text)
  WHERE coalesce(x.name, '') <> ''
  ON CONFLICT (name) DO NOTHING;

  UPDATE _w w SET entity_id = e.id
  FROM public.entities e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND w.uuid IS NOT NULL AND e.xpm_uuid = w.uuid;

  UPDATE _w w SET entity_id = e.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.entities
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
    ORDER BY name, created_at
  ) e
  WHERE w.entity_id IS NULL AND e.name = w.name;

  WITH upd AS (
    UPDATE public.entities e
    SET entity_type = CASE
          WHEN w.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified'
          THEN w.entity_type::entity_type ELSE e.entity_type END,
        xpm_uuid = coalesce(e.xpm_uuid, w.uuid),
        source = 'imported'
    FROM _w w
    WHERE w.entity_id = e.id
      AND (
        (w.entity_type <> 'Unclassified' AND e.entity_type::text = 'Unclassified')
        OR (w.uuid IS NOT NULL AND e.xpm_uuid IS NULL)
      )
    RETURNING 1
  )
  SELECT count(*) INTO _ent_updated FROM upd;

  SELECT count(*) INTO _ent_created FROM _w WHERE entity_id IS NULL;

  WITH ins AS (
    INSERT INTO public.entities (tenant_id, name, xpm_uuid, entity_type, source)
    SELECT _tenant_id, w.name, w.uuid, w.entity_type::entity_type, 'imported'
    FROM _w w WHERE w.entity_id IS NULL
    RETURNING id, name
  )
  UPDATE _w w SET entity_id = ins.id FROM ins WHERE ins.name = w.name;

  CREATE TEMP TABLE _g (name text PRIMARY KEY, structure_id uuid) ON COMMIT DROP;

  INSERT INTO _g (name)
  SELECT DISTINCT g FROM jsonb_array_elements_text(coalesce(_payload->'groups', '[]'::jsonb)) AS g
  WHERE coalesce(g, '') <> ''
  ON CONFLICT (name) DO NOTHING;

  UPDATE _g g SET structure_id = s.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM public.structures
    WHERE tenant_id = _tenant_id AND deleted_at IS NULL
    ORDER BY name, created_at
  ) s
  WHERE s.name = g.name;

  SELECT coalesce(diagram_limit, 0), coalesce(diagram_count, 0)
  INTO _limit, _used
  FROM public.tenants WHERE id = _tenant_id;

  IF _enforce AND _limit > 0 THEN
    _capacity := greatest(0, _limit - _used);
  ELSE
    _capacity := 1000000;
  END IF;

  FOR rec IN SELECT name FROM _g WHERE structure_id IS NULL ORDER BY name LOOP
    IF _capacity <= 0 THEN
      _struct_skipped := _struct_skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, rec.name) RETURNING id INTO _sid;
      UPDATE _g SET structure_id = _sid WHERE name = rec.name;
      _struct_created := _struct_created + 1;
      _capacity := _capacity - 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%Subscription inactive%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
      ELSE
        _warnings := _warnings || to_jsonb(format('Failed to create structure "%s": %s', rec.name, SQLERRM));
      END IF;
    END;
  END LOOP;

  INSERT INTO public.structure_entities (structure_id, entity_id)
  SELECT DISTINCT g.structure_id, w.entity_id
  FROM jsonb_to_recordset(coalesce(_payload->'members', '[]'::jsonb)) AS m(grp text, ent text)
  JOIN _g g ON g.name = m.grp AND g.structure_id IS NOT NULL
  JOIN _w w ON w.name = m.ent AND w.entity_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE _r (
    rownum int,
    rtype text,
    from_key text,
    to_key text,
    from_id uuid,
    to_id uuid,
    label text,
    groups jsonb,
    rel_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _r (rownum, rtype, from_key, to_key, label, groups)
  SELECT x.row, x.type, x.from_key, x.to_key, x.label, coalesce(x.groups, '[]'::jsonb)
  FROM jsonb_to_recordset(coalesce(_payload->'rels', '[]'::jsonb))
       AS x(row int, type text, from_key text, to_key text, label text, groups jsonb);

  UPDATE _r SET from_id = w.entity_id FROM _w w WHERE w.name = _r.from_key;
  UPDATE _r SET to_id = w.entity_id FROM _w w WHERE w.name = _r.to_key;

  UPDATE _r SET from_id = to_id, to_id = from_id
  WHERE rtype IN ('spouse', 'partner') AND from_id IS NOT NULL AND to_id IS NOT NULL AND from_id > to_id;

  UPDATE _r SET from_id = _r.to_id, to_id = _r.from_id
  FROM public.entities a, public.entities b
  WHERE a.id = _r.from_id AND b.id = _r.to_id
    AND _r.rtype = 'member'
    AND a.entity_type::text = 'smsf' AND b.entity_type::text = 'Individual';

  UPDATE _r SET rel_id = e.id
  FROM public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = _r.from_id AND e.to_entity_id = _r.to_id
    AND e.relationship_type::text = _r.rtype;

  BEGIN
    WITH todo AS (
      SELECT DISTINCT from_id, to_id, rtype
      FROM _r
      WHERE rel_id IS NULL AND from_id IS NOT NULL AND to_id IS NOT NULL
    ), ins AS (
      INSERT INTO public.relationships
        (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
      SELECT _tenant_id, t.from_id, t.to_id, t.rtype::relationship_type, 'imported', 'imported'
      FROM todo t
      RETURNING id
    )
    SELECT count(*) INTO _rel_created FROM ins;

    UPDATE _r SET rel_id = e.id
    FROM public.relationships e
    WHERE _r.rel_id IS NULL AND e.tenant_id = _tenant_id
      AND e.from_entity_id = _r.from_id AND e.to_entity_id = _r.to_id
      AND e.relationship_type::text = _r.rtype;
  EXCEPTION WHEN OTHERS THEN
    _rel_created := 0;
    FOR rec IN
      SELECT DISTINCT ON (from_id, to_id, rtype) rownum, from_id, to_id, rtype, label
      FROM _r
      WHERE rel_id IS NULL AND from_id IS NOT NULL AND to_id IS NOT NULL
    LOOP
      BEGIN
        INSERT INTO public.relationships
          (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
        VALUES (_tenant_id, rec.from_id, rec.to_id, rec.rtype::relationship_type, 'imported', 'imported')
        RETURNING id INTO _rid;
        UPDATE _r SET rel_id = _rid
        WHERE from_id = rec.from_id AND to_id = rec.to_id AND rtype = rec.rtype;
        _rel_created := _rel_created + 1;
      EXCEPTION WHEN OTHERS THEN
        _rel_skipped := _rel_skipped + 1;
        IF jsonb_array_length(_warnings) < 200 THEN
          _warnings := _warnings || to_jsonb(format(
            'Row %s: Failed to create relationship %s: %s', rec.rownum, coalesce(rec.label, ''), SQLERRM));
        END IF;
      END;
    END LOOP;
  END;

  INSERT INTO public.structure_relationships (structure_id, relationship_id)
  SELECT DISTINCT g.structure_id, rr.rel_id
  FROM _r rr
  CROSS JOIN LATERAL jsonb_array_elements_text(rr.groups) AS gn(name)
  JOIN _g g ON g.name = gn.name AND g.structure_id IS NOT NULL
  WHERE rr.rel_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  UPDATE public.entities e SET is_trustee_company = true
  WHERE e.tenant_id = _tenant_id
    AND e.entity_type::text = 'Company'
    AND e.is_trustee_company = false
    AND e.id IN (SELECT from_id FROM _r WHERE rtype = 'trustee' AND from_id IS NOT NULL);

  RETURN jsonb_build_object(
    'entitiesCreated', _ent_created,
    'entitiesUpdated', _ent_updated,
    'structuresCreated', _struct_created,
    'structuresSkippedLimit', _struct_skipped,
    'structureLimit', _limit,
    'relationshipsCreated', _rel_created,
    'relationshipsSkipped', _rel_skipped,
    'warnings', _warnings,
    'unavailableGroups', coalesce(
      (SELECT jsonb_agg(name) FROM _g WHERE structure_id IS NULL), '[]'::jsonb),
    'unresolvedRels', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('row', rownum, 'label', label))
       FROM _r WHERE from_id IS NULL OR to_id IS NULL), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_xpm_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_xpm_batch(uuid, jsonb) TO service_role;