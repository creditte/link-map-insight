
-- Add unique constraints on join tables for upsert support
ALTER TABLE public.structure_entities
  ADD CONSTRAINT structure_entities_unique UNIQUE (structure_id, entity_id);

ALTER TABLE public.structure_relationships
  ADD CONSTRAINT structure_relationships_unique UNIQUE (structure_id, relationship_id);
