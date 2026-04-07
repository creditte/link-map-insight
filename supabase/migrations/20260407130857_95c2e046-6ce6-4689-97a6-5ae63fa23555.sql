ALTER TABLE public.profiles
  ADD COLUMN selected_plan text DEFAULT 'pro',
  ADD COLUMN selected_billing text DEFAULT 'monthly';