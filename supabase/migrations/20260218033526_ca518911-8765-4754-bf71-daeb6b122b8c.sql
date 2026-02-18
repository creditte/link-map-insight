
-- ================================================================
-- tenant_users: comprehensive user management table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.tenant_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auth_user_id    uuid,
  email           text NOT NULL,
  display_name    text,
  role            text NOT NULL DEFAULT 'user'
                    CHECK (role IN ('owner', 'admin', 'user')),
  status          text NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'active', 'disabled', 'deleted')),
  invited_at      timestamptz,
  invited_by      uuid,
  last_invited_at timestamptz,
  accepted_at     timestamptz,
  disabled_at     timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id     ON public.tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_auth_user_id  ON public.tenant_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_email         ON public.tenant_users(email);
CREATE INDEX IF NOT EXISTS idx_tenant_users_status        ON public.tenant_users(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tenant_users_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_tenant_users_updated_at
  BEFORE UPDATE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_users_updated_at();

-- ================================================================
-- tenant_user_audit_log: immutable audit trail for user actions
-- ================================================================
CREATE TABLE IF NOT EXISTS public.tenant_user_audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  actor_auth_user_id    uuid NOT NULL,
  action                text NOT NULL,
  target_tenant_user_id uuid,
  target_email          text,
  meta                  jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tual_tenant_id ON public.tenant_user_audit_log(tenant_id);

-- ================================================================
-- RLS: tenant_users
-- ================================================================
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- Helper: is actor owner or admin in a given tenant?
CREATE OR REPLACE FUNCTION public.is_owner_or_admin(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _tenant_id
      AND auth_user_id = auth.uid()
      AND role IN ('owner','admin')
      AND status = 'active'
  )
$$;

-- Helper: is actor owner in a given tenant?
CREATE OR REPLACE FUNCTION public.is_owner(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _tenant_id
      AND auth_user_id = auth.uid()
      AND role = 'owner'
      AND status = 'active'
  )
$$;

-- READ: own row (active) or owner/admin sees all non-deleted
CREATE POLICY "tenant_users_select"
  ON public.tenant_users FOR SELECT
  USING (
    (auth_user_id = auth.uid() AND status = 'active')
    OR
    is_owner_or_admin(tenant_id)
  );

-- INSERT: only owner/admin
CREATE POLICY "tenant_users_insert"
  ON public.tenant_users FOR INSERT
  WITH CHECK (is_owner_or_admin(tenant_id));

-- UPDATE: only owner/admin
CREATE POLICY "tenant_users_update"
  ON public.tenant_users FOR UPDATE
  USING (is_owner_or_admin(tenant_id));

-- ================================================================
-- RLS: tenant_user_audit_log
-- ================================================================
ALTER TABLE public.tenant_user_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tual_select"
  ON public.tenant_user_audit_log FOR SELECT
  USING (is_owner_or_admin(tenant_id));

-- ================================================================
-- RPC A: invite_user (create/upsert)
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_create_tenant_user_invite(
  p_tenant_id    uuid,
  p_email        text,
  p_role         text,
  p_display_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id    uuid := auth.uid();
  _actor_role  text;
  _existing    record;
  _new_id      uuid;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _actor_role = 'user' THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _actor_role = 'admin' AND p_role = 'owner' THEN RAISE EXCEPTION 'Admins cannot assign owner role'; END IF;
  IF p_role NOT IN ('owner','admin','user') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  SELECT * INTO _existing FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND email = lower(trim(p_email));

  IF _existing IS NOT NULL THEN
    UPDATE public.tenant_users SET
      status          = 'invited',
      role            = p_role,
      display_name    = COALESCE(p_display_name, display_name),
      deleted_at      = NULL,
      disabled_at     = NULL,
      invited_at      = now(),
      last_invited_at = now(),
      invited_by      = _actor_id
    WHERE id = _existing.id;
    _new_id := _existing.id;
  ELSE
    INSERT INTO public.tenant_users (tenant_id, email, display_name, role, status, invited_at, last_invited_at, invited_by)
    VALUES (p_tenant_id, lower(trim(p_email)), p_display_name, p_role, 'invited', now(), now(), _actor_id)
    RETURNING id INTO _new_id;
  END IF;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email, meta)
  VALUES (p_tenant_id, _actor_id, 'invited', _new_id, lower(trim(p_email)), jsonb_build_object('role', p_role));

  RETURN jsonb_build_object('id', _new_id, 'email', lower(trim(p_email)));
END;
$$;

-- ================================================================
-- RPC B: reinvite_user
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_reinvite_tenant_user(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status = 'deleted' THEN RAISE EXCEPTION 'Cannot reinvite a deleted user. Restore first.'; END IF;

  UPDATE public.tenant_users SET status = 'invited', last_invited_at = now(), invited_by = _actor_id
  WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'reinvited', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('email', _target.email);
END;
$$;

-- ================================================================
-- RPC C: disable_user
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_disable_tenant_user(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id    uuid := auth.uid();
  _actor_role  text;
  _target      record;
  _owner_count int;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF _target.role = 'owner' THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status = 'active';
    IF _owner_count <= 1 THEN RAISE EXCEPTION 'Cannot disable the last owner'; END IF;
  END IF;

  UPDATE public.tenant_users SET status = 'disabled', disabled_at = now() WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'disabled', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ================================================================
-- RPC D: enable_user
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_enable_tenant_user(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status = 'deleted' THEN RAISE EXCEPTION 'Cannot enable a deleted user. Restore first.'; END IF;

  UPDATE public.tenant_users SET status = 'active', disabled_at = NULL WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'enabled', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ================================================================
-- RPC E: soft_delete_user
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_soft_delete_tenant_user(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id    uuid := auth.uid();
  _actor_role  text;
  _target      record;
  _owner_count int;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role != 'owner' THEN RAISE EXCEPTION 'Only owners can delete users'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF _target.role = 'owner' THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status NOT IN ('deleted');
    IF _owner_count <= 1 THEN RAISE EXCEPTION 'Cannot delete the last owner'; END IF;
  END IF;

  IF _target.auth_user_id = _actor_id THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status = 'active' AND auth_user_id != _actor_id;
    IF _owner_count = 0 THEN RAISE EXCEPTION 'Transfer ownership before deleting yourself'; END IF;
  END IF;

  UPDATE public.tenant_users SET status = 'deleted', deleted_at = now() WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'deleted', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ================================================================
-- RPC F: restore_user
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_restore_tenant_user(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status != 'deleted' THEN RAISE EXCEPTION 'User is not deleted'; END IF;

  UPDATE public.tenant_users SET
    status          = 'invited',
    deleted_at      = NULL,
    disabled_at     = NULL,
    last_invited_at = now(),
    invited_by      = _actor_id
  WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'restored', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('email', _target.email);
END;
$$;

-- ================================================================
-- RPC G: change_role
-- ================================================================
CREATE OR REPLACE FUNCTION public.rpc_change_tenant_user_role(
  p_tenant_id       uuid,
  p_tenant_user_id  uuid,
  p_new_role        text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
  _old_role   text;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_new_role NOT IN ('owner','admin','user') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF _actor_role = 'admin' AND p_new_role = 'owner' THEN RAISE EXCEPTION 'Admins cannot assign owner role'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  _old_role := _target.role;
  UPDATE public.tenant_users SET role = p_new_role WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email, meta)
  VALUES (p_tenant_id, _actor_id, 'role_changed', p_tenant_user_id, _target.email,
    jsonb_build_object('old_role', _old_role, 'new_role', p_new_role));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ================================================================
-- Update handle_new_user to also link tenant_users on signup
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_id UUID;
  _invitation RECORD;
  _role app_role;
  _tu RECORD;
BEGIN
  SELECT i.*, i.role as inv_role INTO _invitation
  FROM public.invitations i
  WHERE i.email = NEW.email
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF _invitation IS NOT NULL THEN
    _tenant_id := _invitation.tenant_id;
    _role := _invitation.inv_role;
    UPDATE public.invitations SET accepted_at = now() WHERE id = _invitation.id;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    SELECT id INTO _tenant_id FROM public.tenants WHERE name = 'creditte' LIMIT 1;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Link tenant_users record if matching email exists
  SELECT * INTO _tu FROM public.tenant_users
  WHERE email = NEW.email AND status IN ('invited', 'active')
  ORDER BY created_at DESC LIMIT 1;

  IF _tu IS NOT NULL THEN
    UPDATE public.tenant_users SET
      auth_user_id = NEW.id,
      accepted_at  = COALESCE(_tu.accepted_at, now()),
      status       = 'active'
    WHERE id = _tu.id;
  END IF;

  RETURN NEW;
END;
$$;
