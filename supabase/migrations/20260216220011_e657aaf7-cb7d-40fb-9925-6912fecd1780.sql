
-- Add branding & export default columns to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS firm_name text,
  ADD COLUMN IF NOT EXISTS brand_primary_color text,
  ADD COLUMN IF NOT EXISTS export_footer_text text,
  ADD COLUMN IF NOT EXISTS export_disclaimer_text text,
  ADD COLUMN IF NOT EXISTS export_show_disclaimer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS export_block_on_critical_health boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS export_default_view_mode text NOT NULL DEFAULT 'full';

-- Backfill firm_name from existing name
UPDATE public.tenants SET firm_name = name WHERE firm_name IS NULL;

-- Make firm_name NOT NULL after backfill
ALTER TABLE public.tenants ALTER COLUMN firm_name SET NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN firm_name SET DEFAULT '';
