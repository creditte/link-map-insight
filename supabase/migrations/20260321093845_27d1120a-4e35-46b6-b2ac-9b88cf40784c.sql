
-- Add billing fields to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_used_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS current_period_start timestamp with time zone,
  ADD COLUMN IF NOT EXISTS current_period_end timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS access_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_locked_reason text,
  ADD COLUMN IF NOT EXISTS diagram_limit integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS diagram_count integer DEFAULT 0;

-- Create stripe_webhook_events table for idempotency
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb
);

-- Enable RLS on webhook events (deny all from client)
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_select_stripe_webhook_events"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated USING (false);

CREATE POLICY "deny_all_insert_stripe_webhook_events"
  ON public.stripe_webhook_events FOR INSERT
  TO authenticated WITH CHECK (false);

CREATE POLICY "deny_all_update_stripe_webhook_events"
  ON public.stripe_webhook_events FOR UPDATE
  TO authenticated USING (false);

CREATE POLICY "deny_all_delete_stripe_webhook_events"
  ON public.stripe_webhook_events FOR DELETE
  TO authenticated USING (false);

-- Set default access_enabled for existing tenants that are trialing
UPDATE public.tenants SET access_enabled = true WHERE subscription_status IN ('trialing', 'active');
