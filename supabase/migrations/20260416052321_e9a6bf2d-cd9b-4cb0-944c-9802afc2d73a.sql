ALTER TABLE public.tenant_users
ADD COLUMN can_manage_billing boolean NOT NULL DEFAULT false;