
-- Add logo_url to tenants
ALTER TABLE public.tenants ADD COLUMN logo_url text;

-- Allow admins to update tenants (needed for logo_url)
CREATE POLICY "Admins can update own tenant"
ON public.tenants
FOR UPDATE
USING (id = get_user_tenant_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- Create tenant-assets storage bucket (public read for export rendering)
INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-assets', 'tenant-assets', true);

-- Storage policies: tenant admins can upload/update/delete, anyone can read (public bucket)
CREATE POLICY "Public read tenant assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'tenant-assets');

CREATE POLICY "Admins can upload tenant assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'tenant-assets'
  AND auth.uid() IS NOT NULL
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = 'tenant'
  AND (storage.foldername(name))[2] = get_user_tenant_id(auth.uid())::text
);

CREATE POLICY "Admins can update tenant assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'tenant-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = 'tenant'
  AND (storage.foldername(name))[2] = get_user_tenant_id(auth.uid())::text
);

CREATE POLICY "Admins can delete tenant assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'tenant-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = 'tenant'
  AND (storage.foldername(name))[2] = get_user_tenant_id(auth.uid())::text
);
