
-- Add tenant-based RLS policies for xero_connections so owners/admins can manage connections
CREATE POLICY "Tenant owners/admins can read xero connections"
ON public.xero_connections
FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid())::text);

CREATE POLICY "Tenant owners/admins can delete xero connections"
ON public.xero_connections
FOR DELETE
TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid())::text);
