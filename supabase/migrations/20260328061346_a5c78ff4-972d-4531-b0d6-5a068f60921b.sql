ALTER TABLE public.structures ADD COLUMN source text NOT NULL DEFAULT 'manual';

-- Set existing XPM-imported structures (those with names matching xpm_groups) to 'xpm'
UPDATE public.structures s
SET source = 'xpm'
WHERE EXISTS (
  SELECT 1 FROM public.xpm_groups g
  WHERE g.tenant_id = s.tenant_id
    AND g.name = s.name
);
