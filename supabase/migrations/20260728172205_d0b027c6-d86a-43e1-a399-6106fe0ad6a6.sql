CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_config TO authenticated, anon;
GRANT ALL ON public.app_config TO service_role;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config readable by all" ON public.app_config;
CREATE POLICY "app_config readable by all"
  ON public.app_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "app_config writable by super admins" ON public.app_config;
CREATE POLICY "app_config writable by super admins"
  ON public.app_config FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

INSERT INTO public.app_config (key, value)
VALUES ('billing_enforcement_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_billing_enforcement_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value)::text::boolean FROM public.app_config WHERE key = 'billing_enforcement_enabled'),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_billing_enforcement_enabled() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.validate_diagram_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
  _limit int;
  _access boolean;
BEGIN
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  -- Central kill-switch: skip all subscription/limit enforcement when disabled.
  IF public.is_billing_enforcement_enabled() = false THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled
  INTO _count, _limit, _access
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _access IS NOT TRUE THEN
    RAISE EXCEPTION 'Subscription inactive. Please activate your subscription to create structures.';
  END IF;

  IF _limit IS NOT NULL AND _count >= _limit THEN
    RAISE EXCEPTION 'Diagram limit reached. Your workspace can have a maximum of % active structures.', _limit;
  END IF;

  RETURN NEW;
END;
$$;