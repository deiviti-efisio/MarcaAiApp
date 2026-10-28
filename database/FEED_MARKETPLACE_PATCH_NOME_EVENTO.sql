-- Nome do evento na agenda após o feed:
--   Procurando: usa o nome que o publicador informou (igual collab ao convidar).
--   Oferta: o contratante informa o nome do evento dele; quem ofereceu
--           recebe esse nome na agenda (igual ao aceitar um convite).
-- Rode no SQL Editor do Supabase.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(uuid, text, date, text, numeric, text, time, time, text, text[], text, boolean);
DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(uuid, text, date, text, numeric, text, time, time, text, text[], text, boolean, text);

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
  v_uf TEXT;
  v_city TEXT;
  v_name TEXT;
  v_id UUID;
  v_start TIME;
  v_end TIME;
  v_funcoes TEXT[];
  v_whatsapp_digits TEXT;
  v_whatsapp_save TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.', NULL::UUID;
    RETURN;
  END IF;

  IF p_feed_tipo IS NULL OR p_feed_tipo NOT IN ('disponivel', 'demanda') THEN
    RETURN QUERY SELECT false, 'Tipo de anúncio inválido.', NULL::UUID;
    RETURN;
  END IF;

  IF p_event_date IS NULL OR p_event_date < public.feed_data_hoje_brasil() THEN
    RETURN QUERY SELECT false, 'Informe uma data de hoje em diante.', NULL::UUID;
    RETURN;
  END IF;

  v_funcoes := ARRAY(
    SELECT DISTINCT trim(f)
    FROM unnest(COALESCE(p_feed_funcoes, ARRAY[]::text[])) AS f
    WHERE length(trim(f)) > 0
  );

  IF COALESCE(array_length(v_funcoes, 1), 0) = 0 THEN
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
    ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para publicar no feed deste artista.', NULL::UUID;
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
  IF v_end <= v_start THEN
    RETURN QUERY SELECT false, 'O horário final precisa ser depois do início.', NULL::UUID;
    RETURN;
  END IF;

  v_name := NULLIF(trim(coalesce(p_nome, '')), '');
  IF p_feed_tipo = 'demanda' THEN
    IF v_name IS NULL THEN
      RETURN QUERY SELECT false, 'Informe o nome do evento.', NULL::UUID;
      RETURN;
    END IF;
  ELSE
    v_name := COALESCE(v_name, 'Oferta');
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

DROP FUNCTION IF EXISTS public.rpc_app_editar_anuncio_feed(uuid, date, text, numeric, text, time, time, text, text[], text, boolean);
DROP FUNCTION IF EXISTS public.rpc_app_editar_anuncio_feed(uuid, date, text, numeric, text, time, time, text, text[], text, boolean, text);

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
  IF v_end <= v_start THEN
    RETURN QUERY SELECT false, 'O horário final precisa ser depois do início.';
    RETURN;
  END IF;

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

DROP FUNCTION IF EXISTS public.rpc_app_iniciar_negociacao_feed(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.rpc_app_iniciar_negociacao_feed(uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.rpc_app_iniciar_negociacao_feed(
  p_evento_id UUID,
  p_artista_interessado_id UUID,
  p_funcao_participacao TEXT,
  p_mensagem TEXT DEFAULT NULL,
  p_nome_evento TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT,
  convite_id UUID,
  cache_valor NUMERIC,
  feed_tipo TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event events%ROWTYPE;
  v_convite_id UUID;
  v_origem_id UUID;
  v_convidado_id UUID;
  v_booking_name TEXT;
  v_convite_nome TEXT;
  v_funcao TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_funcao := NULLIF(trim(coalesce(p_funcao_participacao, '')), '');

  IF NOT public._is_member_of_artist(
    v_uid,
    p_artista_interessado_id,
    ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para negociar com este artista.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM events e
  WHERE e.id = p_evento_id
    AND COALESCE(e.ativo, true) = true
  LIMIT 1;

  IF v_event.id IS NULL OR v_event.feed_tipo IS NULL OR COALESCE(v_event.ativo, true) = false THEN
    RETURN QUERY SELECT false, 'Anúncio não encontrado ou já encerrado.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.feed_tipo = 'demanda' AND v_funcao IS NULL THEN
    RETURN QUERY SELECT false, 'Informe a função que você está oferecendo.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;
  IF v_funcao IS NULL THEN
    v_funcao := 'Interesse';
  END IF;

  IF v_event.event_date < public.feed_data_hoje_brasil() THEN
    RETURN QUERY SELECT false, 'Esta data já passou.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.artist_id = p_artista_interessado_id THEN
    RETURN QUERY SELECT false, 'Você não pode negociar o próprio anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.feed_tipo = 'demanda' THEN
    v_origem_id := v_event.id;
    v_convidado_id := p_artista_interessado_id;
    v_convite_nome := COALESCE(NULLIF(trim(v_event.name), ''), 'Evento');

    IF EXISTS (
      SELECT 1
      FROM convite_participacao_evento c
      WHERE c.evento_origem_id = v_event.id
        AND c.artista_convidado_id = p_artista_interessado_id
        AND c.status IN ('pendente', 'aceito')
    ) THEN
      RETURN QUERY SELECT false, 'Você já enviou uma proposta neste anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM convite_participacao_evento c
      WHERE c.grupo_disputa_id = v_event.id
        AND c.artista_que_convidou_id = p_artista_interessado_id
        AND c.status IN ('pendente', 'aceito')
    ) THEN
      RETURN QUERY SELECT false, 'Você já enviou uma proposta neste anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;

    v_booking_name := NULLIF(trim(coalesce(p_nome_evento, '')), '');
    IF v_booking_name IS NULL THEN
      RETURN QUERY SELECT false, 'Informe o nome do seu evento.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;
    v_convite_nome := v_booking_name;

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
      ativo,
      created_at,
      updated_at
    ) VALUES (
      p_artista_interessado_id,
      v_uid,
      v_uid,
      v_booking_name,
      NULLIF(trim(coalesce(p_mensagem, '')), ''),
      v_event.event_date,
      v_event.start_time,
      v_event.end_time,
      v_event.value,
      v_event.city,
      v_event.state_uf,
      false,
      'evento',
      NULL,
      false,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_origem_id;

    v_convidado_id := v_event.artist_id;
  END IF;

  INSERT INTO convite_participacao_evento (
    evento_origem_id,
    artista_que_convidou_id,
    artista_convidado_id,
    status,
    mensagem,
    nome_evento,
    data_evento,
    hora_inicio,
    hora_fim,
    cache_valor,
    cidade,
    estado_uf,
    telefone_contratante,
    descricao,
    funcao_participacao,
    usuario_que_enviou_id,
    grupo_disputa_id
  ) VALUES (
    v_origem_id,
    CASE
      WHEN v_event.feed_tipo = 'demanda' THEN v_event.artist_id
      ELSE p_artista_interessado_id
    END,
    v_convidado_id,
    'pendente',
    NULLIF(trim(coalesce(p_mensagem, '')), ''),
    v_convite_nome,
    v_event.event_date,
    v_event.start_time,
    v_event.end_time,
    v_event.value,
    v_event.city,
    v_event.state_uf,
    NULL,
    v_event.description,
    v_funcao,
    v_uid,
    v_event.id
  )
  RETURNING id INTO v_convite_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_convite_id, v_event.value, v_event.feed_tipo;
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'Você já enviou uma proposta neste anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, NULL::UUID, NULL::NUMERIC, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_iniciar_negociacao_feed(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
