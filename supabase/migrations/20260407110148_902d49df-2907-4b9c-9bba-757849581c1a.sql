
CREATE OR REPLACE FUNCTION public.validate_relationship_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from_type text;
  _to_type text;
  _is_trust_source boolean;
  _is_trust_target boolean;
  _is_disc_trust_source boolean;
BEGIN
  SELECT entity_type::text INTO _from_type FROM public.entities WHERE id = NEW.from_entity_id;
  SELECT entity_type::text INTO _to_type FROM public.entities WHERE id = NEW.to_entity_id;

  IF _from_type IS NULL OR _to_type IS NULL THEN
    RETURN NEW;
  END IF;

  _is_trust_target := _to_type IN ('Trust', 'trust_discretionary', 'trust_unit', 'trust_hybrid',
    'trust_bare', 'trust_testamentary', 'trust_deceased_estate', 'trust_family', 'smsf');
  _is_trust_source := _from_type IN ('Trust', 'trust_discretionary', 'trust_unit', 'trust_hybrid',
    'trust_bare', 'trust_testamentary', 'trust_deceased_estate', 'trust_family');
  _is_disc_trust_source := _from_type IN ('Trust', 'trust_discretionary', 'trust_family');

  CASE NEW.relationship_type
    WHEN 'director' THEN
      IF _from_type != 'Individual' OR _to_type != 'Company' THEN
        RAISE EXCEPTION 'Directors must be individuals and can only be linked to companies.';
      END IF;

    WHEN 'shareholder' THEN
      IF NOT (_from_type IN ('Individual', 'Company', 'smsf') OR _is_disc_trust_source OR _from_type = 'trust_unit') THEN
        RAISE EXCEPTION 'Shareholders can only be linked to companies.';
      END IF;
      IF _to_type != 'Company' THEN
        RAISE EXCEPTION 'Shareholders can only be linked to companies.';
      END IF;

    WHEN 'trustee' THEN
      IF _from_type NOT IN ('Individual', 'Company') THEN
        RAISE EXCEPTION 'Trustees must be individuals or companies and can only be linked to trusts or SMSFs.';
      END IF;
      IF NOT (_to_type IN ('Trust', 'trust_discretionary', 'trust_unit', 'trust_hybrid',
        'trust_bare', 'trust_testamentary', 'trust_deceased_estate', 'trust_family', 'smsf')) THEN
        RAISE EXCEPTION 'Trustees must be individuals or companies and can only be linked to trusts or SMSFs.';
      END IF;

    WHEN 'beneficiary' THEN
      IF NOT (_from_type IN ('Individual', 'Company') OR _is_disc_trust_source) THEN
        RAISE EXCEPTION 'Beneficiaries can only be linked to eligible trust entities.';
      END IF;
      IF NOT (_to_type IN ('Trust', 'trust_discretionary', 'trust_family', 'trust_hybrid',
        'trust_bare', 'trust_testamentary', 'trust_deceased_estate')) THEN
        RAISE EXCEPTION 'Beneficiaries can only be linked to eligible trust entities.';
      END IF;

    WHEN 'member' THEN
      IF NOT (_from_type IN ('Individual', 'Company', 'smsf') OR _is_disc_trust_source) THEN
        RAISE EXCEPTION 'Members can only be linked to unit trusts or SMSFs.';
      END IF;
      IF _to_type NOT IN ('trust_unit', 'smsf') THEN
        RAISE EXCEPTION 'Members can only be linked to unit trusts or SMSFs.';
      END IF;

    WHEN 'appointer' THEN
      IF _from_type NOT IN ('Individual', 'Company') THEN
        RAISE EXCEPTION 'Appointors must be individuals or companies and can only be linked to trusts.';
      END IF;
      IF NOT (_to_type IN ('Trust', 'trust_discretionary', 'trust_unit', 'trust_family', 'trust_hybrid',
        'trust_bare', 'trust_testamentary', 'trust_deceased_estate')) THEN
        RAISE EXCEPTION 'Appointors must be individuals or companies and can only be linked to trusts.';
      END IF;

    WHEN 'settlor' THEN
      IF _from_type NOT IN ('Individual', 'Company') THEN
        RAISE EXCEPTION 'Settlors can only be linked to trust entities.';
      END IF;
      IF NOT (_to_type IN ('Trust', 'trust_discretionary', 'trust_unit', 'trust_hybrid',
        'trust_bare', 'trust_testamentary', 'trust_deceased_estate', 'trust_family')) THEN
        RAISE EXCEPTION 'Settlors can only be linked to trust entities.';
      END IF;

    WHEN 'partner' THEN
      IF _from_type NOT IN ('Individual', 'Company') OR _to_type NOT IN ('Individual', 'Company') THEN
        RAISE EXCEPTION 'Partners must be individuals or companies.';
      END IF;

    WHEN 'spouse' THEN
      IF _from_type != 'Individual' OR _to_type != 'Individual' THEN
        RAISE EXCEPTION 'Spouse relationships can only be between individuals.';
      END IF;

    WHEN 'parent' THEN
      IF _from_type != 'Individual' OR _to_type != 'Individual' THEN
        RAISE EXCEPTION 'Parent relationships can only be between individuals.';
      END IF;

    WHEN 'child' THEN
      IF _from_type != 'Individual' OR _to_type != 'Individual' THEN
        RAISE EXCEPTION 'Child relationships can only be between individuals.';
      END IF;

    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$function$;
