-- Perfil público do artista: capa, bio e links (YouTube, Spotify, Instagram).
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS cover_url text;

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS bio text;

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.artists.cover_url IS 'URL da imagem de capa do perfil público.';
COMMENT ON COLUMN public.artists.bio IS 'Texto de apresentação exibido no perfil público.';
COMMENT ON COLUMN public.artists.social_links IS 'JSON com youtube, spotify, instagram e videos (array de URLs).';

CREATE INDEX IF NOT EXISTS idx_artists_social_links_gin
  ON public.artists USING gin (social_links);

-- Qualquer usuário autenticado pode ver o cartão público (sem WhatsApp se show_whatsapp = false).
CREATE OR REPLACE FUNCTION public.get_artist_public_profile(p_artist_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  musical_style text,
  profile_url text,
  cover_url text,
  bio text,
  city text,
  state text,
  work_roles jsonb,
  show_formats jsonb,
  social_links jsonb,
  whatsapp text,
  show_whatsapp boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.id,
    a.name,
    a.musical_style,
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    NULLIF(trim(COALESCE(a.cover_url, '')), ''),
    NULLIF(trim(COALESCE(a.bio, '')), ''),
    NULLIF(trim(COALESCE(a.city, '')), ''),
    NULLIF(trim(COALESCE(a.state, '')), ''),
    COALESCE(a.work_roles, '[]'::jsonb),
    COALESCE(a.show_formats, '[]'::jsonb),
    COALESCE(a.social_links, '{}'::jsonb),
    CASE
      WHEN COALESCE(a.show_whatsapp, false)
        THEN NULLIF(trim(COALESCE(a.whatsapp, '')), '')
      ELSE NULL
    END,
    COALESCE(a.show_whatsapp, false)
  FROM public.artists a
  WHERE a.id = p_artist_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_artist_public_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_artist_public_profile(uuid) TO service_role;

-- Posts sociais publicados de um artista específico (perfil público).
CREATE OR REPLACE FUNCTION public.listar_feed_social_artista(
  p_artist_id uuid,
  p_artista_atual_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  artist_id uuid,
  artist_name text,
  artist_image text,
  body text,
  location text,
  created_at timestamptz,
  media_type text,
  media_url text,
  thumbnail_url text,
  likes_count integer,
  comments_count integer,
  is_mine boolean,
  liked_by_me boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    sp.id,
    sp.artist_id,
    a.name,
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    sp.body,
    NULLIF(trim(COALESCE(sp.location, '')), ''),
    sp.created_at,
    media.media_type,
    media.media_url,
    media.thumbnail_url,
    (
      SELECT COUNT(*)::integer
      FROM public.social_post_likes spl
      WHERE spl.post_id = sp.id
    ),
    (
      SELECT COUNT(*)::integer
      FROM public.social_post_comments spc
      WHERE spc.post_id = sp.id
    ),
    (p_artista_atual_id IS NOT NULL AND sp.artist_id = p_artista_atual_id),
    (
      p_artista_atual_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.social_post_likes spl_me
        WHERE spl_me.post_id = sp.id
          AND spl_me.artist_id = p_artista_atual_id
      )
    )
  FROM public.social_posts sp
  INNER JOIN public.artists a ON a.id = sp.artist_id
  LEFT JOIN LATERAL (
    SELECT
      spm.media_type,
      spm.media_url,
      spm.thumbnail_url
    FROM public.social_post_media spm
    WHERE spm.post_id = sp.id
    ORDER BY spm.sort_order, spm.created_at
    LIMIT 1
  ) media ON true
  WHERE sp.is_published = true
    AND sp.artist_id = p_artist_id
  ORDER BY sp.created_at DESC
  LIMIT 40;
$$;

GRANT EXECUTE ON FUNCTION public.listar_feed_social_artista(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_feed_social_artista(uuid, uuid) TO service_role;
