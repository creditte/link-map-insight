-- Enforce billing limits when an archived/deleted structure is restored.
-- Mirrors public.validate_diagram_limit (INSERT) so the same rule cannot be
-- bypassed by flipping archived_at/deleted_at back to NULL.
CREATE OR REPLACE FUNCTION public.validate_diagram_limit_on_restore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
  _limit int;
  _access boolean;
  _was_inactive boolean;
  _is_active boolean;
BEGIN
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  -- Central kill-switch: skip all subscription/limit enforcement when disabled.
  IF public.is_billing_enforcement_enabled() = false THEN
    RETURN NEW;
  END IF;

  _was_inactive := (OLD.archived_at IS NOT NULL OR OLD.deleted_at IS NOT NULL);
  _is_active    := (NEW.archived_at IS NULL AND NEW.deleted_at IS NULL);

  -- Only guard the inactive -> active transition (restore). Archiving, deleting
  -- and ordinary edits are untouched.
  IF NOT (_was_inactive AND _is_active) THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled
  INTO _count, _limit, _access
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _access IS NOT TRUE THEN
    RAISE EXCEPTION 'Subscription inactive. Please activate your subscription to restore structures.';
  END IF;

  -- diagram_count is maintained by trg_update_diagram_count and excludes the
  -- row being restored (it is still archived at this point), so >= is correct.
  IF _limit IS NOT NULL AND _count >= _limit THEN
    RAISE EXCEPTION 'Diagram limit reached. Your workspace can have a maximum of % active structures.', _limit;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_diagram_limit_restore ON public.structures;

CREATE TRIGGER trg_validate_diagram_limit_restore
BEFORE UPDATE ON public.structures
FOR EACH ROW
EXECUTE FUNCTION public.validate_diagram_limit_on_restore();