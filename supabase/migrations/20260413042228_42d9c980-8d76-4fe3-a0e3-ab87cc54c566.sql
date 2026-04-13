
-- Add archived_at column
ALTER TABLE public.structures ADD COLUMN archived_at timestamptz DEFAULT NULL;

-- Update the trigger function to exclude archived structures from count
CREATE OR REPLACE FUNCTION public.update_tenant_diagram_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
BEGIN
  SELECT count(*) INTO _count
  FROM public.structures
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND deleted_at IS NULL
    AND archived_at IS NULL
    AND is_scenario = false;

  UPDATE public.tenants
  SET diagram_count = _count
  WHERE id = COALESCE(NEW.tenant_id, OLD.tenant_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;
