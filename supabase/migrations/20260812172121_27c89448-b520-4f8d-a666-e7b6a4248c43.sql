CREATE INDEX IF NOT EXISTS idx_entities_tenant_xpm_uuid ON public.entities (tenant_id, xpm_uuid) WHERE xpm_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_structures_tenant_name ON public.structures (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_relationships_lookup ON public.relationships (tenant_id, from_entity_id, to_entity_id, relationship_type);