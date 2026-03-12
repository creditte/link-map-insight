
-- Add trial columns to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_starts_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing';
