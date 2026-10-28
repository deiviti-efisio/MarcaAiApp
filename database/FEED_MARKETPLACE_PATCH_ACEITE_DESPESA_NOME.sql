-- Aceite do feed (Oferecendo + Procurando):
-- - Despesa sempre no nome do artista contratado + função real (nunca "Interesse").
-- - Procurando: o anunciante também pode aceitar o candidato.
-- - Oferecendo: função da despesa vem das funções do anúncio.
-- Rode no SQL Editor do Supabase depois de FEED_MARKETPLACE_PATCH_OFERTA_DADOS_CONTRATANTE.sql.

CREATE OR REPLACE FUNCTION public.feed_funcoes_para_despesa(p_funcoes TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    array_to_string(
      ARRAY(
        SELECT NULLIF(trim(f), '')
        FROM unnest(COALESCE(p_funcoes, ARRAY[]::text[])) AS f
        WHERE NULLIF(trim(f), '') IS NOT NULL
      ),
      ' · '
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.rpc_app_iniciar_negociacao_feed(
  p_evento_id UUID,
  p_artista_interessado_id UUID,
  p_funcao_participacao TEXT,
  p_mensagem TEXT DEFAULT NULL,
  p_nome_evento TEXT DEFAULT NULL,
  p_event_date DATE DEFAULT NULL,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state_uf TEXT DEFAULT NULL
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
  v_data DATE;
  v_start TIME;
  v_end TIME;
  v_city TEXT;
  v_uf TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_funcao := NULLIF(trim(coalesce(p_funcao_participacao, '')), '');
  IF v_funcao IS NOT NULL AND lower(v_funcao) = 'interesse' THEN
    v_funcao := NULL;
  END IF;

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

  IF v_event.feed_tipo = 'demanda' THEN
    IF v_funcao IS NULL THEN
      RETURN QUERY SELECT false, 'Informe a função que você está oferecendo.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;
  ELSE
    v_funcao := COALESCE(v_funcao, public.feed_funcoes_para_despesa(v_event.feed_funcoes), 'Participação');
  END IF;

  IF v_event.event_date < public.feed_data_hoje_brasil() THEN
    RETURN QUERY SELECT false, 'Esta data já passou.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.artist_id = p_artista_interessado_id THEN
    RETURN QUERY SELECT false, 'Você não pode negociar o próprio anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.value IS NULL OR v_event.value <= 0 THEN
    RETURN QUERY SELECT false, 'Este anúncio está sem cachê válido. Não é possível negociar.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.feed_tipo = 'demanda' THEN
    v_origem_id := v_event.id;
    v_convidado_id := p_artista_interessado_id;
    v_convite_nome := COALESCE(NULLIF(trim(v_event.name), ''), 'Evento');
    v_data := v_event.event_date;
    v_start := v_event.start_time;
    v_end := v_event.end_time;
    v_city := v_event.city;
    v_uf := v_event.state_uf;

    IF v_data IS NULL OR v_start IS NULL OR v_end IS NULL THEN
      RETURN QUERY SELECT false, 'Este anúncio está incompleto (data ou horário).', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;

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

    v_data := COALESCE(p_event_date, v_event.event_date);
    IF v_data IS NULL OR v_data < public.feed_data_hoje_brasil() THEN
      RETURN QUERY SELECT false, 'Informe uma data de hoje em diante para o evento.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;

    v_start := COALESCE(p_start_time, v_event.start_time);
    v_end := COALESCE(p_end_time, v_event.end_time);
    IF v_start IS NULL OR v_end IS NULL THEN
      RETURN QUERY SELECT false, 'Informe o horário de início e de fim do evento.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;
    IF v_end <= v_start THEN
      RETURN QUERY SELECT false, 'O horário final precisa ser depois do início.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
      RETURN;
    END IF;

    v_city := NULLIF(trim(coalesce(p_city, '')), '');
    v_uf := upper(trim(coalesce(p_state_uf, '')));
    IF length(v_uf) <> 2 THEN
      v_uf := NULL;
    END IF;
    IF v_city IS NULL THEN
      RETURN QUERY SELECT false, 'Informe a cidade do evento.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
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
      v_data,
      v_start,
      v_end,
      v_event.value,
      v_city,
      v_uf,
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
    v_data,
    v_start,
    v_end,
    v_event.value,
    v_city,
    v_uf,
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

GRANT EXECUTE ON FUNCTION public.rpc_app_iniciar_negociacao_feed(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_aceitar_convite_participacao_evento(
  p_convite_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT,
  evento_id UUID,
  despesa_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_convite convite_participacao_evento%ROWTYPE;
  v_nome_artista_convidado TEXT;
  v_nome_despesa TEXT;
  v_funcao_despesa TEXT;
  v_nome_evento TEXT;
  v_cache NUMERIC;
  v_data DATE;
  v_start TIME;
  v_end TIME;
  v_city TEXT;
  v_uf TEXT;
  v_origem events%ROWTYPE;
  v_listing events%ROWTYPE;
  v_pode_aceitar BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.', NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_convite
  FROM convite_participacao_evento c
  WHERE c.id = p_convite_id
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Convite não encontrado.', NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_convite.status <> 'pendente' THEN
    RETURN QUERY SELECT false,
      CASE v_convite.status
        WHEN 'cancelado' THEN 'Este convite foi cancelado e não pode mais ser aceito.'
        WHEN 'aceito' THEN 'Este convite já foi aceito anteriormente.'
        WHEN 'recusado' THEN 'Este convite já foi recusado.'
        ELSE 'Este convite não está mais disponível.'
      END,
      NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_origem
  FROM events e
  WHERE e.id = v_convite.evento_origem_id
  LIMIT 1;

  IF v_origem.feed_tipo IS NOT NULL THEN
    -- Oportunidade: só o dono do anúncio aceita. O evento nasce no aceite.
    v_pode_aceitar := public._is_member_of_artist(
      v_uid,
      v_convite.artista_que_convidou_id,
      ARRAY['editor', 'vendedor', 'admin', 'owner']
    );
  ELSE
    v_pode_aceitar := public._is_member_of_artist(
      v_uid,
      v_convite.artista_convidado_id,
      ARRAY['editor', 'admin', 'owner']
    );
  END IF;

  IF NOT v_pode_aceitar THEN
    RETURN QUERY SELECT false, 'Sem permissão para aceitar este convite.', NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_origem
  FROM events e
  WHERE e.id = v_convite.evento_origem_id
  LIMIT 1;

  SELECT * INTO v_listing
  FROM events e
  WHERE e.id = v_convite.grupo_disputa_id
  LIMIT 1;

  v_cache := v_convite.cache_valor;
  IF v_cache IS NULL OR v_cache <= 0 THEN
    v_cache := COALESCE(v_origem.value, v_listing.value);
  END IF;
  IF v_cache IS NULL OR v_cache <= 0 THEN
    RETURN QUERY SELECT false, 'Convite sem cachê válido para lançar despesa.', NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  v_data := COALESCE(v_convite.data_evento, v_origem.event_date, v_listing.event_date);
  v_start := COALESCE(v_convite.hora_inicio, v_origem.start_time, v_listing.start_time);
  v_end := COALESCE(v_convite.hora_fim, v_origem.end_time, v_listing.end_time);
  v_city := COALESCE(NULLIF(trim(v_convite.cidade), ''), NULLIF(trim(v_origem.city), ''), NULLIF(trim(v_listing.city), ''));
  v_uf := upper(trim(coalesce(
    NULLIF(trim(coalesce(v_convite.estado_uf, '')), ''),
    NULLIF(trim(coalesce(v_origem.state_uf, '')), ''),
    NULLIF(trim(coalesce(v_listing.state_uf, '')), '')
  )));
  IF length(v_uf) <> 2 THEN
    v_uf := NULL;
  END IF;

  IF v_data IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    RETURN QUERY SELECT false, 'Convite incompleto (data ou horário). Não foi possível aceitar.', NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  -- 00:00–00:00 = horário não definido (igual à agenda).
  -- Fim <= início também cobre evento overnight (ex.: 22:00–02:00).
  -- O app permite criar o evento origem assim; o aceite não pode bloquear.

  v_nome_evento := NULLIF(trim(v_convite.nome_evento), '');
  IF v_nome_evento IS NULL
    OR v_nome_evento IN ('Oferta', 'Procurando')
    OR v_nome_evento ~* '^(Oferta|Procurando)\s*[·\-–]'
  THEN
    v_nome_evento := NULLIF(trim(v_origem.name), '');
    IF v_nome_evento IS NULL
      OR v_nome_evento IN ('Oferta', 'Procurando')
      OR v_nome_evento ~* '^(Oferta|Procurando)\s*[·\-–]'
    THEN
      v_nome_evento := COALESCE(NULLIF(trim(v_listing.name), ''), 'Evento');
      IF v_nome_evento IN ('Oferta', 'Procurando')
        OR v_nome_evento ~* '^(Oferta|Procurando)\s*[·\-–]'
      THEN
        v_nome_evento := 'Evento';
      END IF;
    END IF;
  END IF;

  SELECT a.name INTO v_nome_artista_convidado
  FROM artists a
  WHERE a.id = v_convite.artista_convidado_id
  LIMIT 1;

  v_funcao_despesa := NULLIF(trim(coalesce(v_convite.funcao_participacao, '')), '');
  IF v_funcao_despesa IS NULL OR lower(v_funcao_despesa) = 'interesse' THEN
    v_funcao_despesa := COALESCE(
      public.feed_funcoes_para_despesa(v_listing.feed_funcoes),
      public.feed_funcoes_para_despesa(v_origem.feed_funcoes),
      'Participação'
    );
  END IF;

  v_nome_despesa := COALESCE(NULLIF(trim(v_nome_artista_convidado), ''), 'Artista')
    || ' - '
    || v_funcao_despesa;

  BEGIN
    PERFORM 1
    FROM convite_participacao_evento c
    WHERE c.grupo_disputa_id = v_convite.grupo_disputa_id
      AND c.status = 'pendente'
    ORDER BY c.id
    FOR UPDATE;

    SELECT * INTO v_convite
    FROM convite_participacao_evento c
    WHERE c.id = p_convite_id
    FOR UPDATE;

    IF v_convite.status <> 'pendente' THEN
      RETURN QUERY SELECT false,
        CASE v_convite.status
          WHEN 'cancelado' THEN 'Este convite foi cancelado e não pode mais ser aceito.'
          WHEN 'aceito' THEN 'Este convite já foi aceito anteriormente.'
          WHEN 'recusado' THEN 'Este convite já foi recusado.'
          ELSE 'Este convite não está mais disponível.'
        END,
        NULL::UUID, NULL::UUID;
      RETURN;
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
      contractor_phone,
      confirmed,
      tag,
      convite_participacao_id,
      created_at,
      updated_at,
      ativo
    ) VALUES (
      v_convite.artista_convidado_id,
      v_uid,
      v_uid,
      v_nome_evento,
      NULLIF(TRIM(v_convite.mensagem), ''),
      v_data,
      v_start,
      v_end,
      v_cache,
      v_city,
      v_uf,
      v_convite.telefone_contratante,
      true,
      'evento',
      v_convite.id,
      NOW(),
      NOW(),
      true
    )
    RETURNING id INTO evento_id;

    INSERT INTO event_expenses (
      event_id,
      name,
      value,
      receipt_url,
      created_at,
      updated_at
    ) VALUES (
      v_convite.evento_origem_id,
      v_nome_despesa,
      v_cache,
      NULL,
      NOW(),
      NOW()
    )
    RETURNING id INTO despesa_id;

    UPDATE convite_participacao_evento
    SET
      status = 'aceito',
      evento_criado_convidado_id = evento_id,
      despesa_origem_id = despesa_id,
      funcao_participacao = v_funcao_despesa,
      cache_valor = v_cache,
      nome_evento = v_nome_evento,
      data_evento = v_data,
      hora_inicio = v_start,
      hora_fim = v_end,
      cidade = v_city,
      estado_uf = v_uf,
      respondido_em = NOW(),
      atualizado_em = NOW()
    WHERE id = v_convite.id
      AND status = 'pendente';

    UPDATE convite_participacao_evento c
    SET
      status = 'cancelado',
      respondido_em = NOW(),
      atualizado_em = NOW(),
      motivo_cancelamento = 'Outro artista aceitou primeiro nesta mesma rodada de convites (leilão).'
    WHERE c.grupo_disputa_id = v_convite.grupo_disputa_id
      AND c.status = 'pendente'
      AND c.id <> v_convite.id;

    UPDATE public.notifications n
    SET
      read = true,
      title = 'Convite de participação encerrado',
      message = 'Este convite não está mais disponível: outro artista aceitou primeiro nesta mesma rodada de convites (leilão).'
    WHERE n.convite_participacao_evento_id IN (
      SELECT c.id
      FROM convite_participacao_evento c
      WHERE c.grupo_disputa_id = v_convite.grupo_disputa_id
        AND c.id <> v_convite.id
        AND c.status = 'cancelado'
        AND c.motivo_cancelamento = 'Outro artista aceitou primeiro nesta mesma rodada de convites (leilão).'
    );

    UPDATE public.notifications n
    SET
      read = true,
      title = 'Convite de participação aceito',
      message = 'O evento foi adicionado à sua agenda.'
    WHERE n.convite_participacao_evento_id = v_convite.id
      AND n.title = 'Convite de participação em evento';

    RETURN QUERY SELECT true, NULL::TEXT, evento_id, despesa_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN QUERY SELECT false, 'Este convite já gerou um evento na agenda.', NULL::UUID, NULL::UUID;
    WHEN not_null_violation THEN
      RETURN QUERY SELECT false, 'Faltam dados obrigatórios para criar o evento. Tente novamente.', NULL::UUID, NULL::UUID;
    WHEN check_violation THEN
      RETURN QUERY SELECT false, 'Dados inválidos do evento (horário ou local). Não foi possível aceitar.', NULL::UUID, NULL::UUID;
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, SQLERRM, NULL::UUID, NULL::UUID;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_aceitar_convite_participacao_evento(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_app_aceitar_convite_participacao_evento(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
