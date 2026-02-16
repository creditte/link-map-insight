
-- Structure snapshots table
CREATE TABLE public.structure_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  structure_id uuid NOT NULL REFERENCES public.structures(id),
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

ALTER TABLE public.structure_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read snapshots"
  ON public.structure_snapshots FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert snapshots"
  ON public.structure_snapshots FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can update snapshots"
  ON public.structure_snapshots FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- Snapshot entities (frozen copies)
CREATE TABLE public.snapshot_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES public.structure_snapshots(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  name text NOT NULL,
  entity_type text NOT NULL,
  abn text,
  acn text,
  is_operating_entity boolean NOT NULL DEFAULT false,
  is_trustee_company boolean NOT NULL DEFAULT false,
  position_x double precision,
  position_y double precision
);

ALTER TABLE public.snapshot_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read snapshot_entities"
  ON public.snapshot_entities FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.structure_snapshots ss
    WHERE ss.id = snapshot_entities.snapshot_id
    AND ss.tenant_id = get_user_tenant_id(auth.uid())
  ));

CREATE POLICY "Users can insert snapshot_entities"
  ON public.snapshot_entities FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.structure_snapshots ss
    WHERE ss.id = snapshot_entities.snapshot_id
    AND ss.tenant_id = get_user_tenant_id(auth.uid())
  ) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- Snapshot relationships (frozen copies referencing snapshot_entities)
CREATE TABLE public.snapshot_relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES public.structure_snapshots(id) ON DELETE CASCADE,
  from_entity_snapshot_id uuid NOT NULL REFERENCES public.snapshot_entities(id) ON DELETE CASCADE,
  to_entity_snapshot_id uuid NOT NULL REFERENCES public.snapshot_entities(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  ownership_percent numeric,
  ownership_units numeric,
  ownership_class text
);

ALTER TABLE public.snapshot_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read snapshot_relationships"
  ON public.snapshot_relationships FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.structure_snapshots ss
    WHERE ss.id = snapshot_relationships.snapshot_id
    AND ss.tenant_id = get_user_tenant_id(auth.uid())
  ));

CREATE POLICY "Users can insert snapshot_relationships"
  ON public.snapshot_relationships FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.structure_snapshots ss
    WHERE ss.id = snapshot_relationships.snapshot_id
    AND ss.tenant_id = get_user_tenant_id(auth.uid())
  ) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- Index for fast snapshot lookups
CREATE INDEX idx_snapshot_entities_snapshot_id ON public.snapshot_entities(snapshot_id);
CREATE INDEX idx_snapshot_relationships_snapshot_id ON public.snapshot_relationships(snapshot_id);
CREATE INDEX idx_structure_snapshots_structure_id ON public.structure_snapshots(structure_id);
