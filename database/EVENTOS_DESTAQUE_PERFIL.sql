-- Show especial / destaque no perfil do artista (cartaz com imagem).
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS highlight_image_url text;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS featured_at timestamptz;

COMMENT ON COLUMN public.events.is_featured IS
  'Se verdadeiro, o show entra em destaque no perfil público (cartaz especial).';
COMMENT ON COLUMN public.events.highlight_image_url IS
  'Imagem/cartaz do show em destaque no perfil.';
COMMENT ON COLUMN public.events.featured_at IS
  'Quando definido, o show mais recente neste campo vira o destaque principal.';

-- Show que já passou sai do destaque.
UPDATE public.events
SET is_featured = false,
    featured_at = NULL
WHERE COALESCE(is_featured, false) = true
  AND event_date < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;

CREATE INDEX IF NOT EXISTS idx_events_featured_artist
  ON public.events (artist_id, featured_at DESC NULLS LAST, event_date ASC)
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
  highlight_image_url text,
  featured_at timestamptz
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
    NULLIF(trim(COALESCE(e.highlight_image_url, '')), ''),
    e.featured_at
  FROM public.events e
  WHERE e.artist_id = p_artist_id
    AND COALESCE(e.is_featured, false) = true
    AND COALESCE(e.confirmed, false) = true
    AND COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NULL
    AND e.event_date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  ORDER BY e.featured_at DESC NULLS LAST, e.event_date ASC, e.start_time ASC NULLS LAST
  LIMIT 12;
$$;

DROP FUNCTION IF EXISTS public.definir_show_destaque_principal(uuid);

CREATE FUNCTION public.definir_show_destaque_principal(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT e.artist_id INTO v_artist
  FROM public.events e
  WHERE e.id = p_event_id
    AND COALESCE(e.is_featured, false) = true
    AND COALESCE(e.confirmed, false) = true
    AND COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NULL
    AND e.event_date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_artist IS NULL THEN
    RAISE EXCEPTION 'Show em destaque não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.artist_members am
    WHERE am.artist_id = v_artist
      AND am.user_id = auth.uid()
      AND am.role IN ('admin', 'owner', 'vendedor')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o destaque';
  END IF;

  UPDATE public.events
  SET featured_at = NOW(),
      is_featured = true,
      is_public = true,
      updated_at = NOW()
  WHERE id = p_event_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.listar_shows_destaque_artista(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.definir_show_destaque_principal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_show_destaque_principal(uuid) TO service_role;
