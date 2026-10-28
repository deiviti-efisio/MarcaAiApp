-- Feed: devolve o nome do evento no card, não vaza cachê oculto
-- e só envia fotos dos candidatos para o dono do anúncio.
-- Também bloqueia edição se já houver candidatos e, ao encerrar,
-- cancela as candidaturas pendentes.
-- Rode no SQL Editor do Supabase depois de FEED_REPUTACAO_SHOW_CONFIRMADO.sql
-- e FEED_MARKETPLACE_PATCH_NOME_EVENTO.sql.

DROP FUNCTION IF EXISTS public.listar_feed_marketplace(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.listar_feed_marketplace(text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.listar_feed_marketplace(text, text, text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.listar_feed_marketplace(
  p_tipo TEXT DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_cidade TEXT DEFAULT NULL,
  p_artista_atual_id UUID DEFAULT NULL,
  p_funcao TEXT DEFAULT NULL,
  p_evento_detalhe UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  artist_id UUID,
  artist_name TEXT,
  artist_image TEXT,
  musical_style TEXT,
  feed_tipo TEXT,
  event_date DATE,
  start_time TIME,
  end_time TIME,
  city TEXT,
  state_uf TEXT,
  description TEXT,
  evento_nome TEXT,
  feed_funcoes TEXT[],
  artist_whatsapp TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  cache_valor NUMERIC,
  feed_mostrar_cache BOOLEAN,
  tem_cache BOOLEAN,
  propostas_count INTEGER,
  propostas_avatars TEXT[],
  ja_proposei BOOLEAN,
  pode_desfazer BOOLEAN,
  artist_media_nota NUMERIC,
  artist_total_avaliacoes INT,
  artist_shows_realizados INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    e.id,
    e.artist_id,
    a.name,
    COALESCE(
      NULLIF(trim(COALESCE(a.profile_url, '')), ''),
      NULL
    ),
    a.musical_style,
    e.feed_tipo,
    e.event_date,
    e.start_time,
    e.end_time,
    NULLIF(trim(COALESCE(e.city, '')), ''),
    CASE
      WHEN e.state_uf IS NULL OR trim(e.state_uf) = '' THEN NULL
      ELSE upper(trim(e.state_uf))
    END,
    NULLIF(trim(COALESCE(e.description, '')), ''),
    NULLIF(trim(COALESCE(e.name, '')), ''),
    COALESCE(e.feed_funcoes, ARRAY[]::text[]),
    NULLIF(trim(COALESCE(a.whatsapp, '')), ''),
    e.created_at::timestamptz,
    (p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id),
    CASE
      WHEN p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id THEN e.value
      WHEN COALESCE(e.feed_mostrar_cache, false) = true
        AND e.value IS NOT NULL
        AND e.value > 0
      THEN e.value
      WHEN p_evento_detalhe IS NOT NULL
        AND e.id = p_evento_detalhe
        AND e.value IS NOT NULL
        AND e.value > 0
      THEN e.value
      ELSE NULL
    END,
    COALESCE(e.feed_mostrar_cache, false),
    (e.value IS NOT NULL AND e.value > 0),
    (
      SELECT COUNT(*)::integer
      FROM convite_participacao_evento c
      WHERE c.status IN ('pendente', 'aceito')
        AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
    ),
    CASE
      WHEN p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id THEN
        COALESCE(
          (
            SELECT ARRAY(
              SELECT NULLIF(trim(COALESCE(ar.profile_url, '')), '')
              FROM convite_participacao_evento c
              INNER JOIN artists ar ON ar.id = c.artista_convidado_id
              WHERE c.status IN ('pendente', 'aceito')
                AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
              ORDER BY c.criado_em DESC
              LIMIT 3
            )
          ),
          ARRAY[]::text[]
        )
      ELSE ARRAY[]::text[]
    END,
    (
      p_artista_atual_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM convite_participacao_evento c
        WHERE c.status IN ('pendente', 'aceito')
          AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
          AND c.artista_convidado_id = p_artista_atual_id
      )
    ),
    (
      p_artista_atual_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM convite_participacao_evento c
        WHERE c.status = 'pendente'
          AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
          AND c.artista_convidado_id = p_artista_atual_id
      )
    ),
    rep.media_nota_geral,
    COALESCE(rep.total_avaliacoes, 0),
    COALESCE(rep.shows_realizados, 0)
  FROM events e
  INNER JOIN artists a ON a.id = e.artist_id
  LEFT JOIN LATERAL (
    SELECT
      s.media_nota_geral,
      s.total_avaliacoes,
      s.shows_realizados
    FROM public.rpc_app_resumo_reputacao_artistas(ARRAY[e.artist_id]) s
    WHERE s.artista_id = e.artist_id
    LIMIT 1
  ) rep ON true
  WHERE COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NOT NULL
    AND e.feed_tipo IN ('disponivel', 'demanda')
    AND e.event_date >= public.feed_data_hoje_brasil()
    AND (
      p_tipo IS NULL
      OR trim(p_tipo) = ''
      OR p_tipo = 'todos'
      OR (p_tipo = 'meus' AND p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id)
      OR e.feed_tipo = p_tipo
    )
    AND (
      length(trim(coalesce(p_estado, ''))) < 2
      OR (
        coalesce(trim(e.state_uf), '') <> ''
        AND upper(trim(e.state_uf)) = upper(trim(p_estado))
      )
    )
    AND (
      length(trim(coalesce(p_cidade, ''))) < 2
      OR (
        coalesce(trim(e.city), '') <> ''
        AND strpos(
          public.normalize_pt_search(e.city),
          public.normalize_pt_search(p_cidade)
        ) > 0
      )
    )
    AND (
      length(trim(coalesce(p_funcao, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(e.feed_funcoes, ARRAY[]::text[])) AS funcao_item(funcao)
        WHERE public.normalize_pt_search(funcao_item.funcao)
          = public.normalize_pt_search(p_funcao)
      )
    )
    AND (
      p_evento_detalhe IS NULL
      OR e.id = p_evento_detalhe
    )
  ORDER BY
    CASE WHEN p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id THEN 0 ELSE 1 END,
    e.created_at DESC
  LIMIT 120;
$$;

GRANT EXECUTE ON FUNCTION public.listar_feed_marketplace(TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_feed_marketplace(TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_app_editar_anuncio_feed(
  p_evento_id UUID,
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
  error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event events%ROWTYPE;
  v_uf TEXT;
  v_city TEXT;
  v_name TEXT;
  v_start TIME;
  v_end TIME;
  v_funcoes TEXT[];
  v_whatsapp_digits TEXT;
  v_whatsapp_save TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.';
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM events e
  WHERE e.id = p_evento_id
  LIMIT 1;

  IF v_event.id IS NULL OR v_event.feed_tipo IS NULL OR COALESCE(v_event.ativo, true) = false THEN
    RETURN QUERY SELECT false, 'Anúncio não encontrado ou já encerrado.';
    RETURN;
  END IF;

  IF p_event_date IS NULL OR p_event_date < public.feed_data_hoje_brasil() THEN
    RETURN QUERY SELECT false, 'Informe uma data de hoje em diante.';
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(
    v_uid,
    v_event.artist_id,
    ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para editar este anúncio.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM convite_participacao_evento c
    WHERE c.status IN ('pendente', 'aceito')
      AND (c.grupo_disputa_id = p_evento_id OR c.evento_origem_id = p_evento_id)
  ) THEN
    RETURN QUERY SELECT false, 'Este anúncio já tem candidatos e não pode ser editado.';
    RETURN;
  END IF;

  v_funcoes := ARRAY(
    SELECT DISTINCT trim(f)
    FROM unnest(COALESCE(p_feed_funcoes, ARRAY[]::text[])) AS f
    WHERE length(trim(f)) > 0
  );

  IF COALESCE(array_length(v_funcoes, 1), 0) = 0 THEN
    RETURN QUERY SELECT false, 'Selecione pelo menos uma função (ex.: Vocalista, Guitarrista).';
    RETURN;
  END IF;

  IF array_length(v_funcoes, 1) > 8 THEN
    RETURN QUERY SELECT false, 'Selecione no máximo 8 funções.';
    RETURN;
  END IF;

  v_uf := upper(trim(coalesce(p_state_uf, '')));
  IF length(v_uf) <> 2 THEN
    v_uf := NULL;
  END IF;

  IF p_cache_valor IS NULL OR p_cache_valor <= 0 THEN
    RETURN QUERY SELECT false, 'Informe um cachê maior que zero.';
    RETURN;
  END IF;

  v_whatsapp_digits := regexp_replace(trim(coalesce(p_whatsapp, '')), '\D', '', 'g');
  IF length(v_whatsapp_digits) = 11 THEN
    v_whatsapp_save := NULLIF(trim(coalesce(p_whatsapp, '')), '');
    UPDATE public.artists
    SET whatsapp = v_whatsapp_save,
        updated_at = NOW()
    WHERE id = v_event.artist_id;
  END IF;

  v_city := NULLIF(trim(coalesce(p_city, '')), '');
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RETURN QUERY SELECT false, 'Informe o horário de início e de fim.';
    RETURN;
  END IF;
  v_start := p_start_time;
  v_end := p_end_time;

  v_name := NULLIF(trim(coalesce(p_nome, '')), '');
  IF v_event.feed_tipo = 'demanda' THEN
    IF v_name IS NULL THEN
      RETURN QUERY SELECT false, 'Informe o nome do evento.';
      RETURN;
    END IF;
  ELSE
    v_name := COALESCE(v_name, NULLIF(trim(v_event.name), ''), 'Oferta');
  END IF;

  UPDATE events
  SET
    name = v_name,
    description = NULLIF(trim(coalesce(p_observacao, '')), ''),
    event_date = p_event_date,
    start_time = v_start,
    end_time = v_end,
    value = p_cache_valor,
    city = v_city,
    state_uf = v_uf,
    feed_funcoes = v_funcoes,
    feed_mostrar_cache = COALESCE(p_feed_mostrar_cache, false),
    updated_by = v_uid,
    updated_at = NOW()
  WHERE id = p_evento_id;

  RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_editar_anuncio_feed(UUID, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_encerrar_anuncio_feed(
  p_evento_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event events%ROWTYPE;
  v_tem_aceito BOOLEAN := false;
  v_nome TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.';
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM events e
  WHERE e.id = p_evento_id
  LIMIT 1;

  IF v_event.id IS NULL OR v_event.feed_tipo IS NULL OR COALESCE(v_event.ativo, true) = false THEN
    RETURN QUERY SELECT false, 'Anúncio não encontrado.';
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(
    v_uid,
    v_event.artist_id,
    ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para encerrar este anúncio.';
    RETURN;
  END IF;

  v_nome := COALESCE(NULLIF(trim(v_event.name), ''), 'este anúncio');

  SELECT EXISTS (
    SELECT 1
    FROM convite_participacao_evento c
    WHERE c.status = 'aceito'
      AND (c.grupo_disputa_id = p_evento_id OR c.evento_origem_id = p_evento_id)
  ) INTO v_tem_aceito;

  UPDATE convite_participacao_evento c
  SET
    status = 'cancelado',
    motivo_cancelamento = 'Anúncio encerrado pelo publicador.',
    respondido_em = NOW(),
    atualizado_em = NOW()
  WHERE c.status = 'pendente'
    AND (c.grupo_disputa_id = p_evento_id OR c.evento_origem_id = p_evento_id);

  UPDATE events e
  SET
    ativo = false,
    update_ativo = NOW(),
    updated_by = v_uid,
    updated_at = NOW()
  FROM convite_participacao_evento c
  WHERE e.id = c.evento_origem_id
    AND c.status = 'cancelado'
    AND c.motivo_cancelamento = 'Anúncio encerrado pelo publicador.'
    AND (c.grupo_disputa_id = p_evento_id OR c.evento_origem_id = p_evento_id)
    AND e.feed_tipo IS NULL
    AND e.artist_id = c.artista_que_convidou_id
    AND e.id IS DISTINCT FROM p_evento_id
    AND COALESCE(e.ativo, true) = true;

  UPDATE public.notifications n
  SET
    read = true,
    title = 'Anúncio encerrado',
    message = 'O anúncio "' || v_nome || '" foi encerrado. Sua candidatura foi cancelada.'
  FROM convite_participacao_evento c
  WHERE n.convite_participacao_evento_id = c.id
    AND c.status = 'cancelado'
    AND c.motivo_cancelamento = 'Anúncio encerrado pelo publicador.'
    AND (c.grupo_disputa_id = p_evento_id OR c.evento_origem_id = p_evento_id);

  IF v_tem_aceito AND v_event.feed_tipo = 'demanda' THEN
    UPDATE events
    SET
      feed_tipo = NULL,
      confirmed = true,
      ativo = true,
      updated_by = v_uid,
      updated_at = NOW()
    WHERE id = p_evento_id;
  ELSE
    UPDATE events
    SET
      ativo = false,
      update_ativo = NOW(),
      updated_by = v_uid,
      updated_at = NOW()
    WHERE id = p_evento_id;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_encerrar_anuncio_feed(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
