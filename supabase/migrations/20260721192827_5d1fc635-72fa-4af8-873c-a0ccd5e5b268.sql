DROP INDEX IF EXISTS public.idx_trusted_devices_token_hash;
ALTER TABLE public.trusted_devices ADD CONSTRAINT trusted_devices_token_hash_unique UNIQUE (token_hash);