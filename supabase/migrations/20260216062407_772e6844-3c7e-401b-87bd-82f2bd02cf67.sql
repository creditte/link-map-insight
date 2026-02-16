
-- Create entity_merges table for merge traceability
CREATE TABLE public.entity_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  structure_id uuid REFERENCES public.structures(id),
  primary_entity_id uuid NOT NULL REFERENCES public.entities(id),
  merged_entity_id uuid NOT NULL REFERENCES public.entities(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  merged_by uuid NOT NULL
);

ALTER TABLE public.entity_merges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read entity_merges"
ON public.entity_merges FOR SELECT
USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert entity_merges"
ON public.entity_merges FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id(auth.uid())
  AND (has_role(auth.uid(), 'user'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

CREATE INDEX idx_entity_merges_tenant ON public.entity_merges(tenant_id);
CREATE INDEX idx_entity_merges_primary ON public.entity_merges(primary_entity_id);
CREATE INDEX idx_entity_merges_merged ON public.entity_merges(merged_entity_id);
