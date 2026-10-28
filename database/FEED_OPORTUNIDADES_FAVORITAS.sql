-- Favoritos de oportunidades do feed (por usuário logado).
-- Vendedor e admin podem salvar; a lista viva some no dia seguinte ao show.
-- Execute no SQL Editor do Supabase (após FEED_MARKETPLACE.sql / PATCH_VENCIDOS).

CREATE TABLE IF NOT EXISTS public.event_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_favorites_user
  ON public.event_favorites (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_favorites_event
  ON public.event_favorites (event_id);

ALTER TABLE public.event_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_favorites FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.event_favorites TO authenticated;

DROP POLICY IF EXISTS event_favorites_own ON public.event_favorites;
CREATE POLICY event_favorites_own
  ON public.event_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Publicar oportunidade no feed: somente admin/owner (vendedor continua criando evento na agenda).
CREATE OR REPLACE FUNCTION public.rpc_app_publicar_feed(
  p_artista_id UUID,
  p_feed_tipo TEXT,
  p_event_date DATE,
  p_state_uf TEXT,
  p_cache_valor NUMERIC,
  p_city TEXT DEFAULT NULL,
  p_start_time TIME DEFAULT TIME '20:00',
  p_end_time TIME DEFAULT TIME '23:00',
  p_observacao TEXT DEFAULT NULL,
  p_feed_funcoes TEXT[] DEFAULT ARRAY[]::text[],
  p_whatsapp TEXT DEFAULT NULL,
  p_feed_mostrar_cache BOOLEAN DEFAULT false,
  p_nome TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT,
  evento_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_uf TEXT;
  v_city TEXT;
  v_start TIME;
  v_end TIME;
  v_funcoes TEXT[];
  v_whatsapp_digits TEXT;
  v_whatsapp_save TEXT;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login para publicar.', NULL::UUID;
    RETURN;
  END IF;

  IF p_artista_id IS NULL THEN
    RETURN QUERY SELECT false, 'Artista inválido.', NULL::UUID;
    RETURN;
  END IF;

  IF p_feed_tipo IS NULL OR p_feed_tipo NOT IN ('disponivel', 'demanda') THEN
    RETURN QUERY SELECT false, 'Tipo de anúncio inválido.', NULL::UUID;
    RETURN;
  END IF;

  IF p_event_date IS NULL OR p_event_date < public.feed_data_hoje_brasil() THEN
    RETURN QUERY SELECT false, 'Informe uma data de hoje ou futura.', NULL::UUID;
    RETURN;
  END IF;

  v_funcoes := ARRAY(
    SELECT DISTINCT trim(x)
    FROM unnest(COALESCE(p_feed_funcoes, ARRAY[]::text[])) AS x
    WHERE length(trim(x)) >= 2
  );

  IF COALESCE(array_length(v_funcoes, 1), 0) < 1 THEN
    RETURN QUERY SELECT false, 'Selecione pelo menos uma função (ex.: Vocalista, Guitarrista).', NULL::UUID;
    RETURN;
  END IF;

  IF array_length(v_funcoes, 1) > 8 THEN
    RETURN QUERY SELECT false, 'Selecione no máximo 8 funções.', NULL::UUID;
    RETURN;
  END IF;

  v_uf := upper(trim(coalesce(p_state_uf, '')));
  IF length(v_uf) <> 2 THEN
    v_uf := NULL;
  END IF;

  IF p_cache_valor IS NULL OR p_cache_valor <= 0 THEN
    RETURN QUERY SELECT false, 'Informe um cachê maior que zero.', NULL::UUID;
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(
    v_uid,
    p_artista_id,
    ARRAY['admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Somente o administrador pode publicar oportunidade no feed.', NULL::UUID;
    RETURN;
  END IF;

  v_whatsapp_digits := regexp_replace(trim(coalesce(p_whatsapp, '')), '\D', '', 'g');
  IF length(v_whatsapp_digits) = 11 THEN
    v_whatsapp_save := NULLIF(trim(coalesce(p_whatsapp, '')), '');
    UPDATE public.artists
    SET whatsapp = v_whatsapp_save,
        updated_at = NOW()
    WHERE id = p_artista_id;
  END IF;

  v_city := NULLIF(trim(coalesce(p_city, '')), '');
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RETURN QUERY SELECT false, 'Informe o horário de início e de fim.', NULL::UUID;
    RETURN;
  END IF;
  v_start := p_start_time;
  v_end := p_end_time;

  v_name := NULLIF(trim(coalesce(p_nome, '')), '');
  IF p_feed_tipo = 'demanda' THEN
    IF v_name IS NULL THEN
      RETURN QUERY SELECT false, 'Informe o nome do evento.', NULL::UUID;
      RETURN;
    END IF;
  ELSE
    v_name := COALESCE(v_name, 'Oportunidade');
  END IF;

  INSERT INTO events (
    artist_id,
    created_by,
    updated_by,
    name,
    description,
    event_date,
    start_time,
    end_time,
    value,
    city,
    state_uf,
    confirmed,
    tag,
    feed_tipo,
    feed_funcoes,
    feed_mostrar_cache,
    ativo,
    created_at,
    updated_at
  ) VALUES (
    p_artista_id,
    v_uid,
    v_uid,
    v_name,
    NULLIF(trim(coalesce(p_observacao, '')), ''),
    p_event_date,
    v_start,
    v_end,
    p_cache_valor,
    v_city,
    v_uf,
    false,
    'evento',
    p_feed_tipo,
    v_funcoes,
    COALESCE(p_feed_mostrar_cache, false),
    true,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, NULL::UUID;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT, BOOLEAN, TEXT) TO authenticated;

COMMENT ON TABLE public.event_favorites IS
  'Oportunidades salvas pelo usuário. O feed vivo esconde após a data (encerrar_anuncios_feed_vencidos). O favorito permanece até o usuário tirar; o card some da lista aberta.';
