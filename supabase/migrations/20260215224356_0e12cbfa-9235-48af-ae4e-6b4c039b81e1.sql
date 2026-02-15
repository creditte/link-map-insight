
-- Add status tracking to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'disabled')),
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz DEFAULT NULL;

-- Create invitations table
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  email text NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  invited_by uuid NOT NULL,
  accepted_at timestamptz DEFAULT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Only admins can manage invitations
CREATE POLICY "Admins can read invitations"
  ON public.invitations FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update invitations"
  ON public.invitations FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete invitations"
  ON public.invitations FOR DELETE
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to read all profiles in their tenant (for user management)
CREATE POLICY "Admins can read tenant profiles"
  ON public.profiles FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to update profiles in their tenant (for status/disable)
CREATE POLICY "Admins can update tenant profiles"
  ON public.profiles FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to manage roles in their tenant
-- (existing policy "Admins can manage roles" already exists, but let's ensure read for listing)
-- user_roles already has "Admins can manage roles" ALL policy + "Users can read own roles" SELECT

-- Update handle_new_user to set status based on invitation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id UUID;
  _invitation RECORD;
  _role app_role;
BEGIN
  -- Check if there's a pending invitation for this email
  SELECT i.*, i.role as inv_role INTO _invitation
  FROM public.invitations i
  WHERE i.email = NEW.email
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF _invitation IS NOT NULL THEN
    _tenant_id := _invitation.tenant_id;
    _role := _invitation.inv_role;
    
    -- Mark invitation as accepted
    UPDATE public.invitations SET accepted_at = now() WHERE id = _invitation.id;
    
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active');
    
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  ELSE
    -- Default: attach to creditte tenant as user
    SELECT id INTO _tenant_id FROM public.tenants WHERE name = 'creditte' LIMIT 1;
    
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active');
    
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  
  RETURN NEW;
END;
$$;
