
-- Super admins table (tenant-independent)
CREATE TABLE public.super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- Security definer function to check super admin status
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE auth_user_id = auth.uid()
  )
$$;

-- Super admins can read themselves
CREATE POLICY "super_admins_select_own"
ON public.super_admins FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- Super admins can read ALL tenants
CREATE POLICY "super_admin_read_all_tenants"
ON public.tenants FOR SELECT
TO authenticated
USING (public.is_super_admin());

-- Super admins can insert tenants
CREATE POLICY "super_admin_insert_tenants"
ON public.tenants FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin());

-- Super admins can update any tenant
CREATE POLICY "super_admin_update_tenants"
ON public.tenants FOR UPDATE
TO authenticated
USING (public.is_super_admin());

-- Super admins can read all tenant_users
CREATE POLICY "super_admin_read_all_tenant_users"
ON public.tenant_users FOR SELECT
TO authenticated
USING (public.is_super_admin());

-- Super admins can insert tenant_users
CREATE POLICY "super_admin_insert_tenant_users"
ON public.tenant_users FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin());

-- Super admins can update tenant_users
CREATE POLICY "super_admin_update_tenant_users"
ON public.tenant_users FOR UPDATE
TO authenticated
USING (public.is_super_admin());

-- RPC: create a new tenant (super admin only)
CREATE OR REPLACE FUNCTION public.rpc_create_tenant(p_name text, p_firm_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can create tenants';
  END IF;

  INSERT INTO public.tenants (name, firm_name)
  VALUES (p_name, p_firm_name)
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('id', _new_id, 'name', p_name);
END;
$$;

-- RPC: list all tenants with user counts (super admin only)
CREATE OR REPLACE FUNCTION public.rpc_list_all_tenants()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can list all tenants';
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(t))
    FROM (
      SELECT
        tn.id,
        tn.name,
        tn.firm_name,
        tn.created_at,
        (SELECT count(*) FROM public.tenant_users tu WHERE tu.tenant_id = tn.id AND tu.status != 'deleted') as user_count
      FROM public.tenants tn
      ORDER BY tn.created_at DESC
    ) t
  );
END;
$$;

-- RPC: list users for a specific tenant (super admin only)
CREATE OR REPLACE FUNCTION public.rpc_list_tenant_users_admin(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can list tenant users';
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(u))
    FROM (
      SELECT id, email, display_name, role, status, created_at, accepted_at
      FROM public.tenant_users
      WHERE tenant_id = p_tenant_id
      ORDER BY created_at DESC
    ) u
  );
END;
$$;

-- RPC: create owner for a new tenant (super admin only)
CREATE OR REPLACE FUNCTION public.rpc_create_tenant_owner(p_tenant_id uuid, p_email text, p_display_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_id uuid;
  _email text := lower(trim(p_email));
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can create tenant owners';
  END IF;

  INSERT INTO public.tenant_users (tenant_id, email, display_name, role, status, invited_at, last_invited_at, invited_by)
  VALUES (p_tenant_id, _email, p_display_name, 'owner', 'invited', now(), now(), auth.uid())
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('id', _new_id, 'email', _email);
END;
$$;
