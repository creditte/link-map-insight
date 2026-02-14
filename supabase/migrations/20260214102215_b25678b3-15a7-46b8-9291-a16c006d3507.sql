
-- =============================================
-- FIX: Convert all RESTRICTIVE policies to PERMISSIVE
-- for entities, relationships, structures, structure_entities, structure_relationships, audit_log, import_logs, profiles, tenants, user_roles
-- =============================================

-- ENTITIES
DROP POLICY IF EXISTS "Users can read tenant entities" ON public.entities;
DROP POLICY IF EXISTS "Editors can insert entities" ON public.entities;
DROP POLICY IF EXISTS "Editors can update entities" ON public.entities;
DROP POLICY IF EXISTS "Admins can delete entities" ON public.entities;

CREATE POLICY "Users can read tenant entities" ON public.entities FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Editors can insert entities" ON public.entities FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Editors can update entities" ON public.entities FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete entities" ON public.entities FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- RELATIONSHIPS
DROP POLICY IF EXISTS "Users can read tenant relationships" ON public.relationships;
DROP POLICY IF EXISTS "Editors can insert relationships" ON public.relationships;
DROP POLICY IF EXISTS "Editors can update relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins can delete relationships" ON public.relationships;

CREATE POLICY "Users can read tenant relationships" ON public.relationships FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Editors can insert relationships" ON public.relationships FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Editors can update relationships" ON public.relationships FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete relationships" ON public.relationships FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- STRUCTURES
DROP POLICY IF EXISTS "Users can read tenant structures" ON public.structures;
DROP POLICY IF EXISTS "Editors can insert structures" ON public.structures;
DROP POLICY IF EXISTS "Editors can update structures" ON public.structures;
DROP POLICY IF EXISTS "Admins can delete structures" ON public.structures;

CREATE POLICY "Users can read tenant structures" ON public.structures FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Editors can insert structures" ON public.structures FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Editors can update structures" ON public.structures FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete structures" ON public.structures FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- STRUCTURE_ENTITIES
DROP POLICY IF EXISTS "Users can read structure_entities" ON public.structure_entities;
DROP POLICY IF EXISTS "Editors can insert structure_entities" ON public.structure_entities;
DROP POLICY IF EXISTS "Editors can delete structure_entities" ON public.structure_entities;

CREATE POLICY "Users can read structure_entities" ON public.structure_entities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())));

CREATE POLICY "Editors can insert structure_entities" ON public.structure_entities FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Editors can delete structure_entities" ON public.structure_entities FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

-- STRUCTURE_RELATIONSHIPS
DROP POLICY IF EXISTS "Users can read structure_relationships" ON public.structure_relationships;
DROP POLICY IF EXISTS "Editors can insert structure_relationships" ON public.structure_relationships;
DROP POLICY IF EXISTS "Editors can delete structure_relationships" ON public.structure_relationships;

CREATE POLICY "Users can read structure_relationships" ON public.structure_relationships FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())));

CREATE POLICY "Editors can insert structure_relationships" ON public.structure_relationships FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Editors can delete structure_relationships" ON public.structure_relationships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

-- AUDIT_LOG
DROP POLICY IF EXISTS "System can insert audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can read tenant audit_log" ON public.audit_log;

CREATE POLICY "System can insert audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "Users can read tenant audit_log" ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- IMPORT_LOGS
DROP POLICY IF EXISTS "Editors can insert import_logs" ON public.import_logs;
DROP POLICY IF EXISTS "Users can read tenant import_logs" ON public.import_logs;

CREATE POLICY "Editors can insert import_logs" ON public.import_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND user_id = auth.uid() AND (has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can read tenant import_logs" ON public.import_logs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- PROFILES
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- TENANTS
DROP POLICY IF EXISTS "Users can read own tenant" ON public.tenants;

CREATE POLICY "Users can read own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = get_user_tenant_id(auth.uid()));

-- USER_ROLES
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;

CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- =============================================
-- AUDIT TRIGGERS for entity and relationship updates
-- =============================================

CREATE OR REPLACE FUNCTION public.audit_entity_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    'entity_update',
    'entity',
    NEW.id,
    row_to_json(OLD)::jsonb,
    row_to_json(NEW)::jsonb
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_relationship_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    'relationship_update',
    'relationship',
    NEW.id,
    row_to_json(OLD)::jsonb,
    row_to_json(NEW)::jsonb
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_entity_update ON public.entities;
CREATE TRIGGER trg_audit_entity_update
  AFTER UPDATE ON public.entities
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.audit_entity_update();

DROP TRIGGER IF EXISTS trg_audit_relationship_update ON public.relationships;
CREATE TRIGGER trg_audit_relationship_update
  AFTER UPDATE ON public.relationships
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.audit_relationship_update();
