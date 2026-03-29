-- エクスロー・クロニクル拡張スキーマ
-- 既存: public.source_files, public.events は変更しない。
-- 新規: 世界設定・勢力・人物・世界史イベント・作品メタ

-- ---------------------------------------------------------------------------
-- 1. world_settings（世界設定：時代区分・地域・宗教・魔法法則など）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.world_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  name text NOT NULL,
  setting_type text NOT NULL DEFAULT 'other',
  -- 例: era | region | religion | magic_law | culture | other
  parent_id uuid REFERENCES public.world_settings (id) ON DELETE SET NULL,
  sort_key integer NOT NULL DEFAULT 0,
  era_label text,
  -- 物語内の年代表現（events.time と揃えやすい任意ラベル）
  summary text,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_settings_parent ON public.world_settings (parent_id);
CREATE INDEX IF NOT EXISTS idx_world_settings_type ON public.world_settings (setting_type);

-- ---------------------------------------------------------------------------
-- 2. factions（組織・勢力）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.factions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  name text NOT NULL,
  faction_kind text NOT NULL DEFAULT 'other',
  -- 例: nation | religion | guild | military | clan | company | other
  parent_faction_id uuid REFERENCES public.factions (id) ON DELETE SET NULL,
  headquarters text,
  headquarters_setting_id uuid REFERENCES public.world_settings (id) ON DELETE SET NULL,
  founded_era_label text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factions_parent ON public.factions (parent_faction_id);
CREATE INDEX IF NOT EXISTS idx_factions_kind ON public.factions (faction_kind);

-- 勢力間の関係（有向。例: A が B に対して「宗主」「同盟」）
CREATE TABLE IF NOT EXISTS public.faction_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_faction_id uuid NOT NULL REFERENCES public.factions (id) ON DELETE CASCADE,
  to_faction_id uuid NOT NULL REFERENCES public.factions (id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  -- 例: alliance | war | vassal | trade | rivalry | subordinate | unknown
  summary text,
  valid_from_era_label text,
  valid_to_era_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faction_rel_no_self CHECK (from_faction_id <> to_faction_id),
  CONSTRAINT faction_rel_pair_unique UNIQUE (from_faction_id, to_faction_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_faction_rel_from ON public.faction_relationships (from_faction_id);
CREATE INDEX IF NOT EXISTS idx_faction_rel_to ON public.faction_relationships (to_faction_id);

-- ---------------------------------------------------------------------------
-- 3. characters（人物）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  display_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  profile text,
  abilities_summary text,
  gender text,
  life_status text NOT NULL DEFAULT 'unknown',
  -- alive | dead | unknown | other
  birth_era_label text,
  death_era_label text,
  primary_faction_id uuid REFERENCES public.factions (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_characters_primary_faction ON public.characters (primary_faction_id);
CREATE INDEX IF NOT EXISTS idx_characters_display_name ON public.characters (display_name);

-- 所属勢力（複数所属・期間つき）
CREATE TABLE IF NOT EXISTS public.character_faction_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  faction_id uuid NOT NULL REFERENCES public.factions (id) ON DELETE CASCADE,
  role_in_faction text,
  rank_title text,
  from_era_label text,
  to_era_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, faction_id, role_in_faction)
);

CREATE INDEX IF NOT EXISTS idx_char_faction_char ON public.character_faction_memberships (character_id);
CREATE INDEX IF NOT EXISTS idx_char_faction_fac ON public.character_faction_memberships (faction_id);

-- 人物間の関係（有向）
CREATE TABLE IF NOT EXISTS public.character_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  to_character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  -- 例: family | friend | rival | mentor | subordinate | ally | enemy | other
  summary text,
  valid_from_era_label text,
  valid_to_era_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_rel_no_self CHECK (from_character_id <> to_character_id),
  CONSTRAINT character_rel_pair_unique UNIQUE (from_character_id, to_character_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_char_rel_from ON public.character_relationships (from_character_id);
CREATE INDEX IF NOT EXISTS idx_char_rel_to ON public.character_relationships (to_character_id);

-- ---------------------------------------------------------------------------
-- 4. world_events（世界史イベント：作品抽出 events とは別の「正史年表」用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.world_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  title text NOT NULL,
  era_expression text NOT NULL DEFAULT '不明',
  -- 物語内の時代表現（既存 events.time と同様の運用可）
  sort_key double precision NOT NULL DEFAULT 0,
  -- 同一 era 内の並び用（数値化した年代など）
  location_text text,
  location_setting_id uuid REFERENCES public.world_settings (id) ON DELETE SET NULL,
  summary text,
  body text,
  next_world_event_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- 他 world_events への直接因果リンク（アプリ側で参照整合）
  related_extracted_event_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- 任意: public.events.id への参照（配列要素の FK は PG では困難なためアプリで整合）
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_events_era ON public.world_events (era_expression);
CREATE INDEX IF NOT EXISTS idx_world_events_sort ON public.world_events (era_expression, sort_key);

CREATE TABLE IF NOT EXISTS public.world_event_factions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_event_id uuid NOT NULL REFERENCES public.world_events (id) ON DELETE CASCADE,
  faction_id uuid NOT NULL REFERENCES public.factions (id) ON DELETE CASCADE,
  involvement_role text NOT NULL DEFAULT 'participant',
  -- 例: instigator | participant | victim | beneficiary | observer
  notes text,
  UNIQUE (world_event_id, faction_id, involvement_role)
);

CREATE INDEX IF NOT EXISTS idx_we_factions_event ON public.world_event_factions (world_event_id);
CREATE INDEX IF NOT EXISTS idx_we_factions_faction ON public.world_event_factions (faction_id);

CREATE TABLE IF NOT EXISTS public.world_event_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_event_id uuid NOT NULL REFERENCES public.world_events (id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  involvement_role text NOT NULL DEFAULT 'participant',
  notes text,
  UNIQUE (world_event_id, character_id, involvement_role)
);

CREATE INDEX IF NOT EXISTS idx_we_chars_event ON public.world_event_characters (world_event_id);
CREATE INDEX IF NOT EXISTS idx_we_chars_char ON public.world_event_characters (character_id);

-- ---------------------------------------------------------------------------
-- 5. stories（作品情報）— source_files と 1:1 を想定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text NOT NULL UNIQUE REFERENCES public.source_files (source_file) ON UPDATE CASCADE ON DELETE CASCADE,
  display_title text NOT NULL,
  era_primary text,
  stage_summary text,
  synopsis text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_source_file ON public.stories (source_file);

-- 主要キャラクター（任意で複数）
CREATE TABLE IF NOT EXISTS public.story_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories (id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters (id) ON DELETE CASCADE,
  role_in_story text,
  is_main boolean NOT NULL DEFAULT true,
  sort_key integer NOT NULL DEFAULT 0,
  UNIQUE (story_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_story_chars_story ON public.story_characters (story_id);
CREATE INDEX IF NOT EXISTS idx_story_chars_char ON public.story_characters (character_id);
