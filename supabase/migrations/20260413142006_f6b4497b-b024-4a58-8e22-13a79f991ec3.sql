
CREATE OR REPLACE FUNCTION public.rpc_list_all_tenants()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can list all tenants';
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(t))
    FROM (
      SELECT
        tn.id,
        tn.name,
        tn.firm_name,
        tn.created_at,
        tn.subscription_status,
        tn.subscription_plan,
        tn.access_enabled,
        tn.access_locked_reason,
        tn.trial_ends_at,
        tn.current_period_end,
        tn.diagram_count,
        tn.diagram_limit,
        tn.cancel_at_period_end,
        tn.stripe_customer_id,
        (SELECT count(*) FROM public.tenant_users tu WHERE tu.tenant_id = tn.id AND tu.status != 'deleted') as user_count
      FROM public.tenants tn
      ORDER BY tn.created_at DESC
    ) t
  );
END;
$function$;
