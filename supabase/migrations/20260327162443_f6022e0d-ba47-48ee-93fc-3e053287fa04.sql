
-- XPM Groups table to store synced client groups
CREATE TABLE public.xpm_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  xpm_uuid text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, xpm_uuid)
);

ALTER TABLE public.xpm_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read xpm_groups"
  ON public.xpm_groups FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Service role can manage xpm_groups"
  ON public.xpm_groups FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
