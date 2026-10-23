-- Show especial / destaque no perfil do artista (cartaz com imagem, estilo YouTube).
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS highlight_image_url text;

COMMENT ON COLUMN public.events.is_featured IS
  'Se verdadeiro, o show entra em destaque no perfil público (cartaz especial).';
COMMENT ON COLUMN public.events.highlight_image_url IS
  'Imagem/cartaz do show em destaque no perfil.';

CREATE INDEX IF NOT EXISTS idx_events_featured_artist
  ON public.events (artist_id, event_date DESC)
  WHERE COALESCE(is_featured, false)
    AND COALESCE(confirmed, false)
    AND COALESCE(ativo, true)
    AND feed_tipo IS NULL;

DROP FUNCTION IF EXISTS public.listar_shows_destaque_artista(uuid);

CREATE FUNCTION public.listar_shows_destaque_artista(p_artist_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  event_date date,
  start_time text,
  end_time text,
  city text,
  state_uf text,
  tag text,
  highlight_image_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    e.id,
    e.name,
    e.event_date,
    LEFT(COALESCE(e.start_time::text, ''), 5),
    LEFT(COALESCE(e.end_time::text, ''), 5),
    NULLIF(trim(COALESCE(e.city, '')), ''),
    NULLIF(trim(COALESCE(e.state_uf, '')), ''),
    e.tag::text,
    NULLIF(trim(COALESCE(e.highlight_image_url, '')), '')
  FROM public.events e
  WHERE e.artist_id = p_artist_id
    AND COALESCE(e.is_featured, false) = true
    AND COALESCE(e.confirmed, false) = true
    AND COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NULL
  ORDER BY e.event_date DESC, e.start_time DESC NULLS LAST
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO service_role;
