
-- Update audit functions to skip when no authenticated user (e.g. during migrations)
CREATE OR REPLACE FUNCTION public.audit_entity_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'entity_update', 'entity', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_entity_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'entity_insert', 'entity', NEW.id, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_relationship_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'relationship_update', 'relationship', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_relationship_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'relationship_insert', 'relationship', NEW.id, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_relationship_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'relationship_delete', 'relationship', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$function$;

-- Now migrate Trust entities to flat types
UPDATE public.entities SET entity_type = 'smsf', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'SMSF';

UPDATE public.entities SET entity_type = 'trust_discretionary', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Discretionary';

UPDATE public.entities SET entity_type = 'trust_unit', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Unit';

UPDATE public.entities SET entity_type = 'trust_hybrid', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Hybrid';

UPDATE public.entities SET entity_type = 'trust_bare', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Bare';

UPDATE public.entities SET entity_type = 'trust_testamentary', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Testamentary';

UPDATE public.entities SET entity_type = 'trust_deceased_estate', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Deceased Estate';

UPDATE public.entities SET entity_type = 'trust_family', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND trust_subtype = 'Family Trust';

UPDATE public.entities SET entity_type = 'Unclassified', trust_subtype = NULL
  WHERE entity_type = 'Trust' AND (trust_subtype IS NULL OR trust_subtype IN ('Trust-Unknown', 'Unclassified'));
