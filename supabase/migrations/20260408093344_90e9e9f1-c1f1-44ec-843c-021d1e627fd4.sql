UPDATE public.tenants
SET
  stripe_subscription_id = NULL,
  subscription_status = 'trial_expired',
  access_enabled = false,
  access_locked_reason = 'trial_expired',
  current_period_start = NULL,
  current_period_end = NULL,
  cancel_at_period_end = false,
  canceled_at = NULL,
  subscription_plan = 'pro',
  diagram_limit = 50
WHERE stripe_customer_id = 'cus_UISDcPLLp48gLO';