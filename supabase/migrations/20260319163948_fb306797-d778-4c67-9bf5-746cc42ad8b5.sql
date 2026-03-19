
-- Allow 'onz' as a valid provider in pix_configs
ALTER TABLE public.pix_configs DROP CONSTRAINT IF EXISTS pix_configs_provider_check;
ALTER TABLE public.pix_configs ADD CONSTRAINT pix_configs_provider_check CHECK (provider IN ('transfeera', 'onz'));
