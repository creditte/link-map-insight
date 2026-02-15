
-- Feedback table
CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL,
  page text,
  structure_id uuid REFERENCES public.structures(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  metadata jsonb
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert feedback for their tenant
CREATE POLICY "Users can insert feedback"
  ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid())
    AND user_id = auth.uid()
  );

-- Users can read their own feedback
CREATE POLICY "Users can read own feedback"
  ON public.feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all tenant feedback
CREATE POLICY "Admins can read tenant feedback"
  ON public.feedback FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- Admins can update feedback status
CREATE POLICY "Admins can update feedback"
  ON public.feedback FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- Add onboarding_complete to profiles
ALTER TABLE public.profiles ADD COLUMN onboarding_complete boolean NOT NULL DEFAULT false;
