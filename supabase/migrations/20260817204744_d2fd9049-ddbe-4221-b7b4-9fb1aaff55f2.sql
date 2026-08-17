ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_mode text,
  ADD COLUMN IF NOT EXISTS legacy_stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS legacy_stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS legacy_stripe_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_stripe_mode_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_stripe_mode_check
      CHECK (stripe_mode IS NULL OR stripe_mode IN ('test','live'));
  END IF;
END $$;

-- Every existing Stripe id in this project was created in the sandbox account
-- (all subscription ids belong to acct_1TCAbo03zgsCflns / test mode).
UPDATE public.tenants
SET stripe_mode = 'test'
WHERE stripe_mode IS NULL
  AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL);