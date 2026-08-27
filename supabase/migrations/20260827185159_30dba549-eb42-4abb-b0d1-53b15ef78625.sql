CREATE OR REPLACE FUNCTION public.sync_xpm_link_group(
  _tenant_id uuid, _group_uuid text, _group_name text, _member_uuids text[], _member_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _structure_id uuid;
  _created boolean := false;
  _members int := 0;
  _rels int := 0;
  _prev_hash text;
  _member_ids uuid[];
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
    -- Resolved in an array instead of a temp table: several groups are linked
    -- inside one transaction, and a temp table cannot be recreated per group.
    SELECT array_agg(DISTINCT e.id) INTO _member_ids
    FROM public.entities e
    WHERE e.tenant_id = _tenant_id AND e.deleted_at IS NULL
      AND e.xpm_uuid = ANY (_member_uuids);

    IF coalesce(array_length(_member_ids, 1), 0) > 0 THEN
      WITH ins AS (
        INSERT INTO public.structure_entities (structure_id, entity_id)
        SELECT _structure_id, m FROM unnest(_member_ids) AS m
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO _members FROM ins;

      WITH ins AS (
        INSERT INTO public.structure_relationships (structure_id, relationship_id)
        SELECT DISTINCT _structure_id, rel.id
        FROM public.relationships rel
        WHERE rel.tenant_id = _tenant_id AND rel.deleted_at IS NULL
          AND rel.from_entity_id = ANY (_member_ids)
          AND rel.to_entity_id = ANY (_member_ids)
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO _rels FROM ins;
    END IF;
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
$function$;