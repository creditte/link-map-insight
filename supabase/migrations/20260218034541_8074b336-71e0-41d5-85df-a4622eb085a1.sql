
-- 1. Drop the existing restrictive select policy and replace with a correct one
DROP POLICY IF EXISTS "tenant_users_select" ON public.tenant_users;

-- New policy: 
--   a) owner/admin can read all rows in their tenant (via is_owner_or_admin which checks active tenant_users)
--   b) any user can read their OWN row (by auth_user_id) regardless of status
--   c) any active user can read non-deleted rows in their tenant (for regular users to see team)
CREATE POLICY "tenant_users_select_own" ON public.tenant_users
  FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "tenant_users_select_admin" ON public.tenant_users
  FOR SELECT
  USING (is_owner_or_admin(tenant_id));

-- 2. Create a security-definer function to safely backfill + resolve the current user's tenant_user row
--    Called on login to link auth_user_id by email if not yet linked
CREATE OR REPLACE FUNCTION public.link_tenant_user_on_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   uuid := auth.uid();
  _email text;
  _tu    record;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not authenticated'); END IF;

  -- Get email from auth.users (service role context via security definer)
  SELECT email INTO _email FROM auth.users WHERE id = _uid LIMIT 1;
  IF _email IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no email'); END IF;

  -- Find a matching tenant_users row by email that is not yet linked
  SELECT * INTO _tu FROM public.tenant_users
  WHERE lower(email) = lower(_email)
    AND (auth_user_id IS NULL OR auth_user_id = _uid)
    AND status IN ('invited', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no matching tenant_user row');
  END IF;

  -- Link and activate
  UPDATE public.tenant_users SET
    auth_user_id = _uid,
    accepted_at  = COALESCE(accepted_at, now()),
    status       = 'active',
    updated_at   = now()
  WHERE id = _tu.id
    AND (auth_user_id IS NULL OR auth_user_id = _uid);

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_user_id', _tu.id,
    'tenant_id', _tu.tenant_id,
    'role', _tu.role
  );
END;
$$;

-- 3. Create a function to get the current user's tenant_user record (bypasses RLS race conditions)
CREATE OR REPLACE FUNCTION public.get_my_tenant_user()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(tu)::jsonb
  FROM public.tenant_users tu
  WHERE auth_user_id = auth.uid()
    AND status NOT IN ('deleted')
  ORDER BY created_at DESC
  LIMIT 1;
$$;
