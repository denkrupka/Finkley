-- Media blog posts (finkley.app/media) — Supabase-backed.
-- Storage: markdown source-of-truth + metadata in media_posts.
-- Public anon-key SELECT allowed for published posts so Astro landing builds
-- can fetch them at build time.

CREATE TABLE IF NOT EXISTS media_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  cover_url text,
  tags text[] NOT NULL DEFAULT '{}',
  author text NOT NULL DEFAULT 'Finkley',
  draft boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_posts_pub ON media_posts (published_at DESC) WHERE draft = false;

-- App-admin gate: только пользователи в app_admins могут редактировать.
-- Salon owners НЕ имеют доступа автоматически — это Finkley-side blog.
CREATE TABLE IF NOT EXISTS app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE media_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;

-- Публичный read для опубликованных постов (используется и в SPA, и при сборке Astro).
CREATE POLICY "Public read published media_posts"
  ON media_posts FOR SELECT
  USING (draft = false);

-- App-admin может видеть все (включая drafts).
CREATE POLICY "Admins read all media_posts"
  ON media_posts FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM app_admins));

CREATE POLICY "Admins write media_posts"
  ON media_posts FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM app_admins))
  WITH CHECK (auth.uid() IN (SELECT user_id FROM app_admins));

CREATE POLICY "Admins read app_admins"
  ON app_admins FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM app_admins));

-- Bootstrap: первый super-admin задаётся вручную через SQL после деплоя:
--   INSERT INTO app_admins (user_id) VALUES ('<owner-uuid>');
-- После этого админ может добавлять других через таблицу app_admins.

CREATE OR REPLACE FUNCTION touch_media_posts_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_posts_updated ON media_posts;
CREATE TRIGGER trg_media_posts_updated
  BEFORE UPDATE ON media_posts
  FOR EACH ROW EXECUTE FUNCTION touch_media_posts_updated();
