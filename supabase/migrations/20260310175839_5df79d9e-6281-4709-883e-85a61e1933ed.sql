
-- 1. Drop broad SELECT policies that expose tokens
DROP POLICY IF EXISTS "Users can read own xero connections" ON public.xero_connections;
DROP POLICY IF EXISTS "Tenant owners/admins can read xero connections" ON public.xero_connections;

-- 2. Create a narrow SELECT policy that only allows service_role or delete operations
-- (Keep delete/insert/update policies as-is since they're needed for edge functions)

-- 3. Create SECURITY DEFINER function to expose only connection metadata (no tokens)
CREATE OR REPLACE FUNCTION public.get_xero_connection_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'id', xc.id,
      'connected_at', xc.connected_at,
      'expires_at', xc.expires_at,
      'xero_tenant_id', xc.xero_tenant_id,
      'xero_org_name', xc.xero_org_name,
      'connected_by_email', xc.connected_by_email
    )
    FROM public.xero_connections xc
    WHERE xc.tenant_id = (get_user_tenant_id(auth.uid()))::text
    ORDER BY xc.connected_at DESC
    LIMIT 1),
    'null'::jsonb
  );
$$;

-- 4. Create SECURITY DEFINER function to disconnect (delete) by id, only for tenant owners/admins
CREATE OR REPLACE FUNCTION public.disconnect_xero_connection(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tenant_id text;
BEGIN
  -- Get user's tenant
  _tenant_id := (get_user_tenant_id(auth.uid()))::text;
  
  -- Only allow owners/admins
  IF NOT is_owner_or_admin(_tenant_id::uuid) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  DELETE FROM public.xero_connections
  WHERE id = p_connection_id AND tenant_id = _tenant_id;
  
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Create table for OAuth CSRF tokens
CREATE TABLE IF NOT EXISTS public.xero_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false
);

-- No RLS needed - only accessed by edge functions via service role
ALTER TABLE public.xero_oauth_states ENABLE ROW LEVEL SECURITY;
