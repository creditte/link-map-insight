CREATE OR REPLACE FUNCTION public.protect_tenant_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status   IS DISTINCT FROM OLD.subscription_status   THEN _changed := _changed || 'subscription_status'; END IF;
  IF NEW.subscription_plan     IS DISTINCT FROM OLD.subscription_plan     THEN _changed := _changed || 'subscription_plan'; END IF;
  IF NEW.selected_plan         IS DISTINCT FROM OLD.selected_plan         THEN _changed := _changed || 'selected_plan'; END IF;
  IF NEW.stripe_customer_id    IS DISTINCT FROM OLD.stripe_customer_id    THEN _changed := _changed || 'stripe_customer_id'; END IF;
  IF NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN _changed := _changed || 'stripe_subscription_id'; END IF;
  IF NEW.current_period_start  IS DISTINCT FROM OLD.current_period_start  THEN _changed := _changed || 'current_period_start'; END IF;
  IF NEW.current_period_end    IS DISTINCT FROM OLD.current_period_end    THEN _changed := _changed || 'current_period_end'; END IF;
  IF NEW.access_enabled        IS DISTINCT FROM OLD.access_enabled        THEN _changed := _changed || 'access_enabled'; END IF;
  IF NEW.access_locked_reason  IS DISTINCT FROM OLD.access_locked_reason  THEN _changed := _changed || 'access_locked_reason'; END IF;
  IF NEW.diagram_limit         IS DISTINCT FROM OLD.diagram_limit         THEN _changed := _changed || 'diagram_limit'; END IF;
  IF NEW.trial_used_at         IS DISTINCT FROM OLD.trial_used_at         THEN _changed := _changed || 'trial_used_at'; END IF;
  IF NEW.trial_starts_at       IS DISTINCT FROM OLD.trial_starts_at       THEN _changed := _changed || 'trial_starts_at'; END IF;
  IF NEW.trial_ends_at         IS DISTINCT FROM OLD.trial_ends_at         THEN _changed := _changed || 'trial_ends_at'; END IF;
  IF NEW.cancel_at_period_end  IS DISTINCT FROM OLD.cancel_at_period_end  THEN _changed := _changed || 'cancel_at_period_end'; END IF;
  IF NEW.canceled_at           IS DISTINCT FROM OLD.canceled_at           THEN _changed := _changed || 'canceled_at'; END IF;
  IF NEW.last_plan_switch_at   IS DISTINCT FROM OLD.last_plan_switch_at   THEN _changed := _changed || 'last_plan_switch_at'; END IF;

  IF array_length(_changed, 1) > 0 THEN
    RAISE EXCEPTION 'Billing fields are managed by the billing system and cannot be modified directly (attempted: %)', array_to_string(_changed, ', ');
  END IF;

  RETURN NEW;
END;
$$;
