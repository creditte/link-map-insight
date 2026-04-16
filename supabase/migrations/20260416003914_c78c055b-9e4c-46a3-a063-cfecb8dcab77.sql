ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS selected_plan text DEFAULT NULL;

-- Backfill: set selected_plan = subscription_plan for all existing tenants
UPDATE public.tenants SET selected_plan = subscription_plan WHERE selected_plan IS NULL;