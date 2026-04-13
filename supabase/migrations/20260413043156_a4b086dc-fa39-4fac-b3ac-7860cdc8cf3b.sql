-- Recalculate diagram_count for all tenants to fix stale values
UPDATE public.tenants t
SET diagram_count = (
  SELECT count(*) FROM public.structures s
  WHERE s.tenant_id = t.id AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.is_scenario = false
);