-- ── Extensions / indexes ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_xpm_groups_tenant_name ON public.xpm_groups (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON public.entities USING gin (lower(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_import_logs_tenant_status ON public.import_logs (tenant_id, status, updated_at DESC);

ALTER TABLE public.xpm_groups
  ADD COLUMN IF NOT EXISTS member_hash text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- ── Import: one set-based call per slice ────────────────────────────
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
  r record;
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

  -- Match existing entities: xpm_uuid wins, then name.
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

  -- Upgrade Unclassified types / backfill xpm_uuid on existing records.
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

  -- ── Structures (plan capacity respected) ─────────────────────────
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

  FOR r IN SELECT name FROM _g WHERE structure_id IS NULL ORDER BY name LOOP
    IF _capacity <= 0 THEN
      _struct_skipped := _struct_skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, r.name) RETURNING id INTO _sid;
      UPDATE _g SET structure_id = _sid WHERE name = r.name;
      _struct_created := _struct_created + 1;
      _capacity := _capacity - 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%limit reached%' OR SQLERRM ILIKE '%Subscription inactive%' THEN
        _capacity := 0;
        _struct_skipped := _struct_skipped + 1;
      ELSE
        _warnings := _warnings || to_jsonb(format('Failed to create structure "%s": %s', r.name, SQLERRM));
      END IF;
    END;
  END LOOP;

  -- ── Structure membership ─────────────────────────────────────────
  INSERT INTO public.structure_entities (structure_id, entity_id)
  SELECT DISTINCT g.structure_id, w.entity_id
  FROM jsonb_to_recordset(coalesce(_payload->'members', '[]'::jsonb)) AS m(grp text, ent text)
  JOIN _g g ON g.name = m.grp AND g.structure_id IS NOT NULL
  JOIN _w w ON w.name = m.ent AND w.entity_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- ── Relationships ────────────────────────────────────────────────
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

  UPDATE _r r SET from_id = w.entity_id FROM _w w WHERE w.name = r.from_key;
  UPDATE _r r SET to_id = w.entity_id FROM _w w WHERE w.name = r.to_key;

  -- Stable ordering for symmetric relationships.
  UPDATE _r SET from_id = to_id, to_id = from_id
  WHERE rtype IN ('spouse', 'partner') AND from_id IS NOT NULL AND to_id IS NOT NULL AND from_id > to_id;

  -- Individual → SMSF direction for member relationships.
  UPDATE _r r SET from_id = r.to_id, to_id = r.from_id
  FROM public.entities a, public.entities b
  WHERE a.id = r.from_id AND b.id = r.to_id
    AND r.rtype = 'member'
    AND a.entity_type::text = 'smsf' AND b.entity_type::text = 'Individual';

  UPDATE _r r SET rel_id = e.id
  FROM public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = r.from_id AND e.to_entity_id = r.to_id
    AND e.relationship_type::text = r.rtype;

  -- Try one bulk insert; on any trigger rejection isolate the offenders.
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
      RETURNING id, from_entity_id, to_entity_id, relationship_type
    )
    SELECT count(*) INTO _rel_created FROM ins;

    UPDATE _r r SET rel_id = e.id
    FROM public.relationships e
    WHERE r.rel_id IS NULL AND e.tenant_id = _tenant_id
      AND e.from_entity_id = r.from_id AND e.to_entity_id = r.to_id
      AND e.relationship_type::text = r.rtype;
  EXCEPTION WHEN OTHERS THEN
    _rel_created := 0;
    FOR r IN
      SELECT DISTINCT ON (from_id, to_id, rtype) rownum, from_id, to_id, rtype, label
      FROM _r
      WHERE rel_id IS NULL AND from_id IS NOT NULL AND to_id IS NOT NULL
    LOOP
      BEGIN
        INSERT INTO public.relationships
          (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
        VALUES (_tenant_id, r.from_id, r.to_id, r.rtype::relationship_type, 'imported', 'imported')
        RETURNING id INTO _rid;
        UPDATE _r SET rel_id = _rid
        WHERE from_id = r.from_id AND to_id = r.to_id AND rtype = r.rtype;
        _rel_created := _rel_created + 1;
      EXCEPTION WHEN OTHERS THEN
        _rel_skipped := _rel_skipped + 1;
        IF jsonb_array_length(_warnings) < 200 THEN
          _warnings := _warnings || to_jsonb(format(
            'Row %s: Failed to create relationship %s: %s', r.rownum, coalesce(r.label, ''), SQLERRM));
        END IF;
      END;
    END LOOP;
  END;

  INSERT INTO public.structure_relationships (structure_id, relationship_id)
  SELECT DISTINCT g.structure_id, r.rel_id
  FROM _r r
  CROSS JOIN LATERAL jsonb_array_elements_text(r.groups) AS gn(name)
  JOIN _g g ON g.name = gn.name AND g.structure_id IS NOT NULL
  WHERE r.rel_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Corporate trustee flag, one statement.
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

REVOKE ALL ON FUNCTION public.import_xpm_batch(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_xpm_batch(uuid, jsonb) TO service_role;

-- ── Sync: one call per XPM client page ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_xpm_upsert_clients(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _ent_created int := 0;
  _ent_updated int := 0;
  _rel_created int := 0;
  _rel_skipped int := 0;
  _warnings jsonb := '[]'::jsonb;
  _rid uuid;
  r record;
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
    to_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _sr (rtype, from_uuid, to_uuid)
  SELECT x.type, x.from_uuid, x.to_uuid
  FROM jsonb_to_recordset(coalesce(_payload->'rels', '[]'::jsonb))
       AS x(type text, from_uuid text, to_uuid text)
  WHERE coalesce(x.type, '') <> '';

  UPDATE _sr s SET from_id = c.entity_id FROM _c c WHERE c.uuid = s.from_uuid;
  UPDATE _sr s SET to_id = c.entity_id FROM _c c WHERE c.uuid = s.to_uuid;

  UPDATE _sr SET from_id = to_id, to_id = from_id
  WHERE rtype IN ('spouse', 'partner') AND from_id IS NOT NULL AND to_id IS NOT NULL AND from_id > to_id;

  SELECT count(*) INTO _rel_skipped FROM _sr WHERE from_id IS NULL OR to_id IS NULL;

  DELETE FROM _sr s
  USING public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = s.from_id AND e.to_entity_id = s.to_id
    AND e.relationship_type::text = s.rtype;

  BEGIN
    WITH todo AS (
      SELECT DISTINCT from_id, to_id, rtype FROM _sr
      WHERE from_id IS NOT NULL AND to_id IS NOT NULL
    ), ins AS (
      INSERT INTO public.relationships
        (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
      SELECT _tenant_id, t.from_id, t.to_id, t.rtype::relationship_type, 'imported', 'imported'
      FROM todo t
      RETURNING id
    )
    SELECT count(*) INTO _rel_created FROM ins;
  EXCEPTION WHEN OTHERS THEN
    _rel_created := 0;
    FOR r IN
      SELECT DISTINCT ON (from_id, to_id, rtype) from_id, to_id, rtype FROM _sr
      WHERE from_id IS NOT NULL AND to_id IS NOT NULL
    LOOP
      BEGIN
        INSERT INTO public.relationships
          (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
        VALUES (_tenant_id, r.from_id, r.to_id, r.rtype::relationship_type, 'imported', 'imported')
        RETURNING id INTO _rid;
        _rel_created := _rel_created + 1;
      EXCEPTION WHEN OTHERS THEN
        _rel_skipped := _rel_skipped + 1;
        IF jsonb_array_length(_warnings) < 100 THEN
          _warnings := _warnings || to_jsonb(format('Skipped %s relationship: %s', r.rtype, SQLERRM));
        END IF;
      END;
    END LOOP;
  END;

  RETURN jsonb_build_object(
    'entitiesCreated', _ent_created,
    'entitiesUpdated', _ent_updated,
    'relationshipsCreated', _rel_created,
    'relationshipsSkipped', _rel_skipped,
    'warnings', _warnings
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_xpm_upsert_clients(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_xpm_upsert_clients(uuid, jsonb) TO service_role;

-- ── Sync: corporate trustee resolution, set-based ───────────────────
CREATE OR REPLACE FUNCTION public.sync_xpm_link_trustees(_tenant_id uuid, _pairs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _created int := 0;
BEGIN
  CREATE TEMP TABLE _tp (trustee_uuid text, trust_name text) ON COMMIT DROP;
  INSERT INTO _tp (trustee_uuid, trust_name)
  SELECT x.trustee_uuid, x.trust_name
  FROM jsonb_to_recordset(coalesce(_pairs, '[]'::jsonb)) AS x(trustee_uuid text, trust_name text)
  WHERE coalesce(x.trustee_uuid, '') <> '' AND coalesce(x.trust_name, '') <> '';

  CREATE TEMP TABLE _tm (from_id uuid, to_id uuid) ON COMMIT DROP;
  INSERT INTO _tm (from_id, to_id)
  SELECT DISTINCT trustee.id, m.id
  FROM _tp p
  JOIN public.entities trustee
    ON trustee.tenant_id = _tenant_id AND trustee.deleted_at IS NULL AND trustee.xpm_uuid = p.trustee_uuid
  JOIN LATERAL (
    SELECT e.id FROM public.entities e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND lower(e.name) LIKE '%' || lower(p.trust_name) || '%'
    ORDER BY length(e.name)
    LIMIT 1
  ) m ON true
  WHERE trustee.id <> m.id;

  DELETE FROM _tm t
  USING public.relationships e
  WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
    AND e.from_entity_id = t.from_id AND e.to_entity_id = t.to_id
    AND e.relationship_type = 'trustee';

  BEGIN
    WITH ins AS (
      INSERT INTO public.relationships
        (tenant_id, from_entity_id, to_entity_id, relationship_type, source, confidence)
      SELECT _tenant_id, t.from_id, t.to_id, 'trustee', 'imported', 'imported'
      FROM (SELECT DISTINCT from_id, to_id FROM _tm) t
      RETURNING id
    )
    SELECT count(*) INTO _created FROM ins;
  EXCEPTION WHEN OTHERS THEN
    _created := 0;
  END;

  RETURN jsonb_build_object('relationshipsCreated', _created);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_xpm_link_trustees(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_xpm_link_trustees(uuid, jsonb) TO service_role;

-- ── Sync: link one group in a single call, with change detection ─────
CREATE OR REPLACE FUNCTION public.sync_xpm_link_group(
  _tenant_id uuid,
  _group_uuid text,
  _group_name text,
  _member_uuids text[],
  _member_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _structure_id uuid;
  _created boolean := false;
  _members int := 0;
  _rels int := 0;
  _prev_hash text;
BEGIN
  SELECT member_hash INTO _prev_hash
  FROM public.xpm_groups
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  SELECT id INTO _structure_id
  FROM public.structures
  WHERE tenant_id = _tenant_id AND name = _group_name AND deleted_at IS NULL
  ORDER BY created_at LIMIT 1;

  IF _structure_id IS NOT NULL AND _prev_hash IS NOT NULL AND _prev_hash = _member_hash THEN
    UPDATE public.xpm_groups SET last_synced_at = now()
    WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;
    RETURN jsonb_build_object('skipped', true);
  END IF;

  IF _structure_id IS NULL THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, _group_name)
      RETURNING id INTO _structure_id;
      _created := true;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('skipped', false, 'error', SQLERRM);
    END;
  END IF;

  IF coalesce(array_length(_member_uuids, 1), 0) > 0 THEN
    CREATE TEMP TABLE _m (entity_id uuid PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO _m (entity_id)
    SELECT DISTINCT e.id FROM public.entities e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND e.xpm_uuid = ANY (_member_uuids)
    ON CONFLICT DO NOTHING;

    WITH ins AS (
      INSERT INTO public.structure_entities (structure_id, entity_id)
      SELECT _structure_id, entity_id FROM _m
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO _members FROM ins;

    WITH ins AS (
      INSERT INTO public.structure_relationships (structure_id, relationship_id)
      SELECT DISTINCT _structure_id, rel.id
      FROM public.relationships rel
      WHERE rel.tenant_id = _tenant_id AND rel.deleted_at IS NULL
        AND rel.from_entity_id IN (SELECT entity_id FROM _m)
        AND rel.to_entity_id IN (SELECT entity_id FROM _m)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO _rels FROM ins;
  END IF;

  UPDATE public.xpm_groups
  SET member_hash = _member_hash, last_synced_at = now(), updated_at = now()
  WHERE tenant_id = _tenant_id AND xpm_uuid = _group_uuid;

  RETURN jsonb_build_object(
    'skipped', false,
    'structureCreated', _created,
    'members', _members,
    'relationships', _rels
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_xpm_link_group(uuid, text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_xpm_link_group(uuid, text, text, text[], text) TO service_role;

-- ── Sync: fallback structure, restricted to this sync's records ──────
CREATE OR REPLACE FUNCTION public.sync_xpm_ensure_fallback_structure(_tenant_id uuid, _since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _structure_id uuid;
  _members int := 0;
  _rels int := 0;
BEGIN
  SELECT id INTO _structure_id
  FROM public.structures
  WHERE tenant_id = _tenant_id AND name = 'XPM Import' AND deleted_at IS NULL
  ORDER BY created_at LIMIT 1;

  IF _structure_id IS NULL THEN
    BEGIN
      INSERT INTO public.structures (tenant_id, name) VALUES (_tenant_id, 'XPM Import')
      RETURNING id INTO _structure_id;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('error', SQLERRM);
    END;
  END IF;

  WITH ins AS (
    INSERT INTO public.structure_entities (structure_id, entity_id)
    SELECT _structure_id, e.id FROM public.entities e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND e.source = 'imported' AND e.updated_at >= _since
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _members FROM ins;

  WITH ins AS (
    INSERT INTO public.structure_relationships (structure_id, relationship_id)
    SELECT _structure_id, r.id FROM public.relationships r
    WHERE r.tenant_id = _tenant_id AND r.deleted_at IS NULL
      AND r.source = 'imported' AND r.updated_at >= _since
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _rels FROM ins;

  RETURN jsonb_build_object('members', _members, 'relationships', _rels);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_xpm_ensure_fallback_structure(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_xpm_ensure_fallback_structure(uuid, timestamptz) TO service_role;

-- ── Stale job reaper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_stale_import_jobs(_max_idle_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _n int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.import_logs
    SET status = 'failed',
        result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
          'success', false,
          'error', format('Job stopped responding for more than %s minutes and was marked as failed.', _max_idle_minutes)
        )
    WHERE status = 'processing'
      AND updated_at < now() - make_interval(mins => _max_idle_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fail_stale_import_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_stale_import_jobs(int) TO service_role;