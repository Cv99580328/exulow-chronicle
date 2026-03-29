CREATE TABLE IF NOT EXISTS public.story_factions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories (id) ON DELETE CASCADE,
  faction_id uuid NOT NULL REFERENCES public.factions (id) ON DELETE CASCADE,
  role_in_story text,
  sort_key integer NOT NULL DEFAULT 0,
  UNIQUE (story_id, faction_id)
);

CREATE INDEX IF NOT EXISTS idx_story_factions_story ON public.story_factions (story_id);
CREATE INDEX IF NOT EXISTS idx_story_factions_faction ON public.story_factions (faction_id);
