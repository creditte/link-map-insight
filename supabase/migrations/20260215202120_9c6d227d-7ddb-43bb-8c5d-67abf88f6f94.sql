
-- Add deleted_at column for soft delete
ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Audit functions
CREATE OR REPLACE FUNCTION public.audit_relationship_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'relationship_insert', 'relationship', NEW.id, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_relationship_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'relationship_delete', 'relationship', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_entity_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, after_state)
  VALUES (NEW.tenant_id, auth.uid(), 'entity_insert', 'entity', NEW.id, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$$;

-- Drop and recreate all triggers
DROP TRIGGER IF EXISTS trg_audit_entity_insert ON public.entities;
DROP TRIGGER IF EXISTS trg_audit_entity_update ON public.entities;
DROP TRIGGER IF EXISTS trg_audit_relationship_insert ON public.relationships;
DROP TRIGGER IF EXISTS trg_audit_relationship_update ON public.relationships;
DROP TRIGGER IF EXISTS trg_audit_relationship_soft_delete ON public.relationships;

CREATE TRIGGER trg_audit_entity_insert AFTER INSERT ON public.entities FOR EACH ROW EXECUTE FUNCTION public.audit_entity_insert();
CREATE TRIGGER trg_audit_entity_update AFTER UPDATE ON public.entities FOR EACH ROW EXECUTE FUNCTION public.audit_entity_update();
CREATE TRIGGER trg_audit_relationship_insert AFTER INSERT ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.audit_relationship_insert();
CREATE TRIGGER trg_audit_relationship_update AFTER UPDATE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.audit_relationship_update();
CREATE TRIGGER trg_audit_relationship_soft_delete AFTER UPDATE ON public.relationships FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION public.audit_relationship_delete();
