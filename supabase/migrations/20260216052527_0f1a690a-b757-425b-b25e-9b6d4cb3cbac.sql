
-- Enable fuzzystrmatch extension for Levenshtein distance
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch SCHEMA extensions;

-- Create fuzzy duplicate detection function
CREATE OR REPLACE FUNCTION public.find_fuzzy_duplicate_entities(_tenant_id uuid, _threshold float DEFAULT 0.85)
RETURNS TABLE(
  entity_id_a uuid,
  name_a text,
  type_a text,
  entity_id_b uuid,
  name_b text,
  type_b text,
  similarity float
)
LANGUAGE sql
STABLE SECURITY DEFINER
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
    (1.0 - (extensions.levenshtein(
      left(a.norm_name, 255),
      left(b.norm_name, 255)
    )::float / GREATEST(length(left(a.norm_name, 255)), length(left(b.norm_name, 255)), 1)))::float as similarity
  FROM normalized a
  JOIN normalized b ON a.id < b.id AND a.etype = b.etype
  WHERE (1.0 - (extensions.levenshtein(
    left(a.norm_name, 255),
    left(b.norm_name, 255)
  )::float / GREATEST(length(left(a.norm_name, 255)), length(left(b.norm_name, 255)), 1))) >= _threshold
  ORDER BY similarity DESC, a.norm_name, a.id;
$$;
