-- Update trigger to also fire on archived_at changes
DROP TRIGGER IF EXISTS trg_update_diagram_count ON public.structures;
CREATE TRIGGER trg_update_diagram_count
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at, is_scenario, archived_at
  ON public.structures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_tenant_diagram_count();