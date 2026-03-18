
-- MFA settings per user (stores chosen method)
CREATE TABLE public.mfa_settings (
  user_id uuid PRIMARY KEY,
  method text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mfa_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own_mfa_settings" ON public.mfa_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insert_own_mfa_settings" ON public.mfa_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_own_mfa_settings" ON public.mfa_settings FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Email OTP codes (only accessed via service role in edge functions)
CREATE TABLE public.mfa_email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mfa_email_codes ENABLE ROW LEVEL SECURITY;

-- Email MFA verification records (tracks verified sessions)
CREATE TABLE public.mfa_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  method text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.mfa_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own_mfa_verifications" ON public.mfa_verifications FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_mfa_email_codes_user ON public.mfa_email_codes (user_id, used, expires_at);
CREATE INDEX idx_mfa_verifications_user ON public.mfa_verifications (user_id, expires_at);
