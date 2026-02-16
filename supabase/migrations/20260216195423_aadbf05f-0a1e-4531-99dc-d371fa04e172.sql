
-- Add scenario columns to structures table
ALTER TABLE public.structures
  ADD COLUMN parent_structure_id uuid REFERENCES public.structures(id),
  ADD COLUMN is_scenario boolean NOT NULL DEFAULT false,
  ADD COLUMN scenario_label text;
