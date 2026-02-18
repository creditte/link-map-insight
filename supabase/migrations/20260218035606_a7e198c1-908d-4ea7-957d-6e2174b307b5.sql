
CREATE OR REPLACE FUNCTION public.rpc_create_tenant_user_invite(
  p_tenant_id    uuid,
  p_email        text,
  p_role         text,
  p_display_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _new_id     uuid;
  _email      text := lower(trim(p_email));
BEGIN
  -- Validate actor permissions
  SELECT role INTO _actor_role
  FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';

  IF _actor_role IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _actor_role = 'user' THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _actor_role = 'admin' AND p_role = 'owner' THEN RAISE EXCEPTION 'Admins cannot assign owner role'; END IF;
  IF p_role NOT IN ('owner','admin','user') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  -- Atomic upsert: insert or update on conflict (prevents race conditions)
  INSERT INTO public.tenant_users
    (tenant_id, email, display_name, role, status, invited_at, last_invited_at, invited_by,
     deleted_at, disabled_at)
  VALUES
    (p_tenant_id, _email, p_display_name, p_role, 'invited', now(), now(), _actor_id,
     NULL, NULL)
  ON CONFLICT (tenant_id, email) DO UPDATE SET
    status          = 'invited',
    role            = EXCLUDED.role,
    display_name    = COALESCE(EXCLUDED.display_name, public.tenant_users.display_name),
    deleted_at      = NULL,
    disabled_at     = NULL,
    invited_at      = COALESCE(public.tenant_users.invited_at, now()),
    last_invited_at = now(),
    invited_by      = EXCLUDED.invited_by
  RETURNING id INTO _new_id;

  INSERT INTO public.tenant_user_audit_log
    (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email, meta)
  VALUES
    (p_tenant_id, _actor_id, 'invited', _new_id, _email, jsonb_build_object('role', p_role));

  RETURN jsonb_build_object('id', _new_id, 'email', _email);
END;
$$;
