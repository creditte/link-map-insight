
-- Enums
CREATE TYPE public.entity_type AS ENUM (
  'Individual', 'Company', 'Trust', 'Partnership', 'Sole Trader', 'Incorporated Association/Club', 'Unclassified'
);

CREATE TYPE public.trust_subtype AS ENUM (
  'Discretionary', 'Unit', 'Hybrid', 'Bare', 'Testamentary', 'Deceased Estate', 'Family Trust', 'SMSF', 'Trust-Unknown', 'Unclassified'
);

CREATE TYPE public.relationship_type AS ENUM (
  'director', 'shareholder', 'beneficiary', 'trustee', 'appointer', 'settlor', 'partner', 'spouse', 'parent', 'child'
);

CREATE TYPE public.data_source AS ENUM ('imported', 'manual');

CREATE TYPE public.confidence_level AS ENUM ('imported', 'confirmed', 'edited');

CREATE TYPE public.import_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

-- Tenants
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed creditte tenant
INSERT INTO public.tenants (name) VALUES ('creditte');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles (separate table per security guidelines)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Get user tenant_id function
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- Auto-create profile on signup (assign to creditte tenant)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT id INTO _tenant_id FROM public.tenants WHERE name = 'creditte' LIMIT 1;
  INSERT INTO public.profiles (user_id, tenant_id, full_name)
  VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Entities
CREATE TABLE public.entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  entity_type public.entity_type NOT NULL DEFAULT 'Unclassified',
  trust_subtype public.trust_subtype,
  abn TEXT,
  acn TEXT,
  source public.data_source NOT NULL DEFAULT 'manual',
  verified BOOLEAN NOT NULL DEFAULT false,
  xpm_uuid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relationships
CREATE TABLE public.relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  from_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  to_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relationship_type public.relationship_type NOT NULL,
  ownership_percent DECIMAL,
  ownership_units DECIMAL,
  ownership_class TEXT,
  start_date DATE,
  end_date DATE,
  source public.data_source NOT NULL DEFAULT 'manual',
  confidence public.confidence_level NOT NULL DEFAULT 'imported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Structures
CREATE TABLE public.structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Join tables
CREATE TABLE public.structure_entities (
  structure_id UUID NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  PRIMARY KEY (structure_id, entity_id)
);

CREATE TABLE public.structure_relationships (
  structure_id UUID NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  PRIMARY KEY (structure_id, relationship_id)
);

-- Import logs
CREATE TABLE public.import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  raw_payload TEXT,
  file_name TEXT,
  status public.import_status NOT NULL DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON public.entities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_relationships_updated_at BEFORE UPDATE ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_structures_updated_at BEFORE UPDATE ON public.structures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_import_logs_updated_at BEFORE UPDATE ON public.import_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Tenant policies: users can read their own tenant
CREATE POLICY "Users can read own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_user_tenant_id(auth.uid()));

-- Profile policies
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- User roles policies
CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Entity policies (tenant-scoped)
CREATE POLICY "Users can read tenant entities" ON public.entities FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Editors can insert entities" ON public.entities FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Editors can update entities" ON public.entities FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete entities" ON public.entities FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Relationship policies (tenant-scoped)
CREATE POLICY "Users can read tenant relationships" ON public.relationships FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Editors can insert relationships" ON public.relationships FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Editors can update relationships" ON public.relationships FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete relationships" ON public.relationships FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Structure policies (tenant-scoped)
CREATE POLICY "Users can read tenant structures" ON public.structures FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Editors can insert structures" ON public.structures FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Editors can update structures" ON public.structures FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete structures" ON public.structures FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Structure join table policies
CREATE POLICY "Users can read structure_entities" ON public.structure_entities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Editors can insert structure_entities" ON public.structure_entities FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Editors can delete structure_entities" ON public.structure_entities FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can read structure_relationships" ON public.structure_relationships FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Editors can insert structure_relationships" ON public.structure_relationships FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Editors can delete structure_relationships" ON public.structure_relationships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.structures s WHERE s.id = structure_id AND s.tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));

-- Import log policies
CREATE POLICY "Users can read tenant import_logs" ON public.import_logs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Editors can insert import_logs" ON public.import_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND user_id = auth.uid() AND (public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'admin')));

-- Audit log policies
CREATE POLICY "Users can read tenant audit_log" ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "System can insert audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND user_id = auth.uid());

-- Indexes
CREATE INDEX idx_entities_tenant ON public.entities(tenant_id);
CREATE INDEX idx_entities_xpm_uuid ON public.entities(xpm_uuid);
CREATE INDEX idx_entities_name ON public.entities(tenant_id, name);
CREATE INDEX idx_relationships_tenant ON public.relationships(tenant_id);
CREATE INDEX idx_relationships_from ON public.relationships(from_entity_id);
CREATE INDEX idx_relationships_to ON public.relationships(to_entity_id);
CREATE INDEX idx_structures_tenant ON public.structures(tenant_id);
CREATE INDEX idx_import_logs_tenant ON public.import_logs(tenant_id);
CREATE INDEX idx_audit_log_tenant ON public.audit_log(tenant_id);
