-- Fix bacijoj740@keecs.com: link tenant_users to auth user
UPDATE public.tenant_users SET
  auth_user_id = '83cee4be-552a-49f6-b94a-8f12abd7104a',
  accepted_at = now(),
  status = 'active',
  updated_at = now()
WHERE id = '1acce95c-b8e5-4ab5-8fd9-7d54f3dacb08';

-- Fix profile to point to Org A tenant
UPDATE public.profiles SET
  tenant_id = 'c695b8fc-fadc-459b-9e00-4d18870ed00d',
  onboarding_complete = false,
  updated_at = now()
WHERE user_id = '83cee4be-552a-49f6-b94a-8f12abd7104a';

-- Fix user_roles: owner should have admin role
INSERT INTO public.user_roles (user_id, role)
VALUES ('83cee4be-552a-49f6-b94a-8f12abd7104a', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;