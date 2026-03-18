
-- Drop the overly permissive "Admins can manage roles" policy
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

-- Create tenant-scoped policies for user_roles
-- Admins can only READ roles for users in their own tenant
CREATE POLICY "Admins can read tenant user roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.tenant_id = get_user_tenant_id(auth.uid())
  )
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Admins can only INSERT roles for users in their own tenant
CREATE POLICY "Admins can insert tenant user roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.tenant_id = get_user_tenant_id(auth.uid())
  )
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Admins can only UPDATE roles for users in their own tenant
CREATE POLICY "Admins can update tenant user roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.tenant_id = get_user_tenant_id(auth.uid())
  )
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Admins can only DELETE roles for users in their own tenant
CREATE POLICY "Admins can delete tenant user roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.tenant_id = get_user_tenant_id(auth.uid())
  )
  AND has_role(auth.uid(), 'admin'::app_role)
);
