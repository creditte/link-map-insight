
-- Table to store signup verification codes (service-role only access)
CREATE TABLE public.signup_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signup_verifications ENABLE ROW LEVEL SECURITY;

-- Deny all client access (only service role can touch this)
CREATE POLICY "deny_all_select_signup_verifications" ON public.signup_verifications FOR SELECT TO authenticated USING (false);
CREATE POLICY "deny_all_insert_signup_verifications" ON public.signup_verifications FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "deny_all_update_signup_verifications" ON public.signup_verifications FOR UPDATE TO authenticated USING (false);
CREATE POLICY "deny_all_delete_signup_verifications" ON public.signup_verifications FOR DELETE TO authenticated USING (false);
