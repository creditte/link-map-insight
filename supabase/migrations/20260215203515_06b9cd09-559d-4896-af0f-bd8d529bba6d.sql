
-- Add new entity_type values to the enum (must be committed before use)
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_discretionary';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_unit';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_hybrid';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_bare';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_testamentary';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_deceased_estate';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'trust_family';
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'smsf';
