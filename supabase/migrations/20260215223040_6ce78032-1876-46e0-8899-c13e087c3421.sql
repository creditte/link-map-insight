
-- Add soft-delete and merge tracking columns to entities
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS merged_into_entity_id uuid DEFAULT NULL REFERENCES public.entities(id);

-- Create index for efficient filtering of active entities
CREATE INDEX IF NOT EXISTS idx_entities_deleted_at ON public.entities (deleted_at) WHERE deleted_at IS NULL;

-- Create index for merge lookups
CREATE INDEX IF NOT EXISTS idx_entities_merged_into ON public.entities (merged_into_entity_id) WHERE merged_into_entity_id IS NOT NULL;

-- Create a database function for finding duplicate candidates by normalized name
CREATE OR REPLACE FUNCTION public.find_duplicate_entities(_tenant_id uuid)
RETURNS TABLE(
  entity_id_a uuid,
  name_a text,
  type_a text,
  entity_id_b uuid,
  name_b text,
  type_b text,
  normalized_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH normalized AS (
    SELECT
      id,
      name,
      entity_type::text as etype,
      lower(regexp_replace(
        regexp_replace(
          regexp_replace(name, '\s+(pty|ltd|limited|proprietary|inc|incorporated|llc|trust|pty ltd|as trustee for)\s*', ' ', 'gi'),
          '[^a-zA-Z0-9\s]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )) as norm_name
    FROM public.entities
    WHERE tenant_id = _tenant_id
      AND deleted_at IS NULL
  )
  SELECT
    a.id as entity_id_a,
    a.name as name_a,
    a.etype as type_a,
    b.id as entity_id_b,
    b.name as name_b,
    b.etype as type_b,
    a.norm_name as normalized_name
  FROM normalized a
  JOIN normalized b ON a.norm_name = b.norm_name AND a.id < b.id
  ORDER BY a.norm_name, a.id;
$$;
