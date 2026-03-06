
-- Create roles reference/lookup table
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name text NOT NULL UNIQUE,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read roles
CREATE POLICY "Authenticated users can read roles"
  ON public.roles FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins can modify roles
CREATE POLICY "Super admins can manage roles"
  ON public.roles FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Insert default roles
INSERT INTO public.roles (role_name, is_super_admin) VALUES
  ('OWNER', false),
  ('ADMIN', false),
  ('STAFF', false),
  ('SUPER_ADMIN', true);
