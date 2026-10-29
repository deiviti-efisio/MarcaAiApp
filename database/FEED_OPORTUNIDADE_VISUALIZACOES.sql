-- Quem visualizou uma oportunidade do feed.
-- Só administrador ou dono do artista que publicou consulta a lista.
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.opportunity_views (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  viewer_artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, viewer_artist_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_views_event
  ON public.opportunity_views (event_id, viewed_at DESC);

ALTER TABLE public.opportunity_views ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.opportunity_views FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_registrar_visualizacao_oportunidade(
  p_evento_id uuid,
  p_artista_id uuid
)
RETURNS TABLE (success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_feed text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login para continuar.';
    RETURN;
  END IF;

  IF p_evento_id IS NULL OR p_artista_id IS NULL THEN
    RETURN QUERY SELECT false, 'Oportunidade inválida.';
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(v_uid, p_artista_id, NULL) THEN
    RETURN QUERY SELECT false, 'Sem permissão para registrar esta visualização.';
    RETURN;
  END IF;

  SELECT e.artist_id, e.feed_tipo
  INTO v_owner, v_feed
  FROM public.events e
  WHERE e.id = p_evento_id
    AND COALESCE(e.ativo, true) = true;

  IF v_owner IS NULL OR v_feed IS NULL OR v_feed NOT IN ('disponivel', 'demanda') THEN
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  IF v_owner = p_artista_id THEN
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.opportunity_views (event_id, viewer_artist_id, viewed_at)
  VALUES (p_evento_id, p_artista_id, now())
  ON CONFLICT (event_id, viewer_artist_id)
  DO UPDATE SET viewed_at = now();

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_app_listar_visualizacoes_oportunidade(
  p_evento_id uuid
)
RETURNS TABLE (
  artist_id uuid,
  artist_name text,
  artist_image text,
  viewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR p_evento_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.artist_id
  INTO v_owner
  FROM public.events e
  WHERE e.id = p_evento_id;

  IF v_owner IS NULL OR NOT public._is_member_of_artist(v_uid, v_owner, ARRAY['admin', 'owner']) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.profile_url,
    v.viewed_at
  FROM public.opportunity_views v
  JOIN public.artists a ON a.id = v.viewer_artist_id
  WHERE v.event_id = p_evento_id
  ORDER BY v.viewed_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_registrar_visualizacao_oportunidade(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_app_listar_visualizacoes_oportunidade(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_listar_visualizacoes_artista(
  p_artista_id uuid
)
RETURNS TABLE (
  event_id uuid,
  artist_id uuid,
  artist_name text,
  artist_image text,
  viewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_artista_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(v_uid, p_artista_id, ARRAY['admin', 'owner']) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v.event_id,
    a.id,
    a.name,
    a.profile_url,
    v.viewed_at
  FROM public.opportunity_views v
  JOIN public.events e ON e.id = v.event_id
  JOIN public.artists a ON a.id = v.viewer_artist_id
  WHERE e.artist_id = p_artista_id
    AND e.feed_tipo IN ('disponivel', 'demanda')
  ORDER BY v.viewed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_listar_visualizacoes_artista(uuid) TO authenticated;
