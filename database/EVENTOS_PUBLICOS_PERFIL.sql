-- Datas públicas no perfil do artista.
-- Evento confirmado + is_public = true aparece no calendário do perfil.
-- Cachê e dados financeiros NÃO entram neste RPC.
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.is_public IS
  'Se verdadeiro e confirmed, a data aparece no calendário público do perfil (sem cachê).';

CREATE INDEX IF NOT EXISTS idx_events_public_confirmed
  ON public.events (artist_id, event_date)
  WHERE COALESCE(is_public, false)
    AND COALESCE(confirmed, false)
    AND COALESCE(ativo, true)
    AND feed_tipo IS NULL;

DROP FUNCTION IF EXISTS public.listar_agenda_publica_artista(uuid);

CREATE FUNCTION public.listar_agenda_publica_artista(p_artist_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  event_date date,
  start_time text,
  end_time text,
  city text,
  state_uf text,
  tag text
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
    e.tag::text
  FROM public.events e
  WHERE e.artist_id = p_artist_id
    AND COALESCE(e.confirmed, false) = true
    AND COALESCE(e.is_public, false) = true
    AND COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NULL
  ORDER BY e.event_date ASC, e.start_time ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.listar_agenda_publica_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_agenda_publica_artista(uuid) TO service_role;
