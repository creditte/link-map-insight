
CREATE TABLE public.favourite_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  group_xpm_uuid text NOT NULL,
  group_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_xpm_uuid)
);

ALTER TABLE public.favourite_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own favourites"
  ON public.favourite_groups FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own favourites"
  ON public.favourite_groups FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own favourites"
  ON public.favourite_groups FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
