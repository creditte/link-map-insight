ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS xero_org_name text;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS connected_by_email text;