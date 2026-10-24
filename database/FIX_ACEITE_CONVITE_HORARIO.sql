-- Corrige aceite de convite_participacao_evento com horário 00:00–00:00
-- (não definido na agenda) ou evento overnight (ex.: 22:00–02:00).
-- A RPC rejeitava v_end <= v_start e o colaborador não conseguia aceitar.
--
-- Rode no SQL Editor do Supabase.

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

  v_pode_aceitar := public._is_member_of_artist(
    v_uid,
    v_convite.artista_convidado_id,
    ARRAY['editor', 'admin', 'owner']
  );

  -- Procurando: o anunciante escolhe o candidato (despesa continua no nome do convidado).
  IF NOT v_pode_aceitar THEN
    SELECT * INTO v_origem
    FROM events e
    WHERE e.id = v_convite.evento_origem_id
    LIMIT 1;

    IF v_origem.feed_tipo = 'demanda'
      AND public._is_member_of_artist(
        v_uid,
        v_convite.artista_que_convidou_id,
        ARRAY['editor', 'vendedor', 'admin', 'owner']
      )
    THEN
      v_pode_aceitar := true;
    END IF;
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

    -- Não duplicar: se o convidado já tem o evento (anúncio/rascunho), só reativa.
    SELECT e.id
    INTO evento_id
    FROM events e
    WHERE COALESCE(e.ativo, true) = true
      AND e.artist_id = v_convite.artista_convidado_id
      AND (
        e.convite_participacao_id = v_convite.id
        OR e.id = v_convite.evento_origem_id
        OR e.id = v_convite.grupo_disputa_id
      )
    ORDER BY CASE
      WHEN e.convite_participacao_id = v_convite.id THEN 0
      WHEN e.id = v_convite.evento_origem_id THEN 1
      ELSE 2
    END
    LIMIT 1;

    IF evento_id IS NULL THEN
      SELECT e.id
      INTO evento_id
      FROM events e
      WHERE e.artist_id = v_convite.artista_convidado_id
        AND (
          e.convite_participacao_id = v_convite.id
          OR e.id = v_convite.evento_origem_id
          OR e.id = v_convite.grupo_disputa_id
        )
      ORDER BY CASE WHEN COALESCE(e.ativo, true) THEN 0 ELSE 1 END
      LIMIT 1;
    END IF;

    IF evento_id IS NOT NULL THEN
      UPDATE events
      SET
        ativo = true,
        confirmed = true,
        feed_tipo = NULL,
        name = COALESCE(v_nome_evento, name),
        event_date = COALESCE(v_data, event_date),
        start_time = COALESCE(v_start, start_time),
        end_time = COALESCE(v_end, end_time),
        value = COALESCE(v_cache, value),
        city = COALESCE(v_city, city),
        state_uf = COALESCE(v_uf, state_uf),
        convite_participacao_id = COALESCE(convite_participacao_id, v_convite.id),
        updated_at = NOW()
      WHERE id = evento_id;
    ELSIF v_convite.artista_convidado_id IS DISTINCT FROM v_origem.artist_id THEN
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
    ELSE
      evento_id := v_origem.id;
      UPDATE events
      SET ativo = true, confirmed = true, feed_tipo = NULL, updated_at = NOW()
      WHERE id = evento_id;
    END IF;

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

-- Anúncio do feed vira evento; rascunho do interessado entra na agenda.
-- NÃO apaga o evento do dono (ativo=false) nem cria segunda linha no mesmo artista.
CREATE OR REPLACE FUNCTION public.trg_feed_apos_aceitar_convite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aceito' AND OLD.status IS DISTINCT FROM 'aceito' THEN
    UPDATE events
    SET
      feed_tipo = NULL,
      confirmed = true,
      ativo = true,
      updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND feed_tipo = 'demanda';

    UPDATE events
    SET
      ativo = true,
      confirmed = true,
      feed_tipo = NULL,
      updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND artist_id = NEW.artista_que_convidou_id
      AND feed_tipo IS NULL;

    UPDATE events
    SET
      feed_tipo = NULL,
      confirmed = true,
      ativo = true,
      updated_at = NOW()
    WHERE id = NEW.grupo_disputa_id
      AND feed_tipo = 'disponivel';
  END IF;

  RETURN NEW;
END;
$$;

-- Cópia do convite no MESMO artista do evento original: considera apagada.
UPDATE events copia
SET
  ativo = false,
  update_ativo = NOW(),
  updated_at = NOW()
FROM convite_participacao_evento c
JOIN events origem
  ON origem.id = c.evento_origem_id
WHERE copia.convite_participacao_id = c.id
  AND copia.id IS DISTINCT FROM origem.id
  AND copia.artist_id = origem.artist_id
  AND COALESCE(copia.ativo, true) = true;

-- Mesmo artista, mesma data e nome: mantém o original, apaga a cópia do convite.
UPDATE events copia
SET
  ativo = false,
  update_ativo = NOW(),
  updated_at = NOW()
FROM events original
WHERE copia.convite_participacao_id IS NOT NULL
  AND original.convite_participacao_id IS NULL
  AND copia.id <> original.id
  AND copia.artist_id = original.artist_id
  AND copia.event_date = original.event_date
  AND COALESCE(copia.ativo, true) = true
  AND COALESCE(original.ativo, true) = true
  AND original.feed_tipo IS NULL
  AND (
    lower(trim(coalesce(copia.name, ''))) = lower(trim(coalesce(original.name, '')))
    OR copia.name ILIKE original.name || ' · %'
  );

UPDATE events e
SET
  ativo = false,
  update_ativo = NOW(),
  updated_at = NOW()
WHERE COALESCE(e.ativo, true) = true
  AND e.convite_participacao_id IS NOT NULL
  AND e.id NOT IN (
    SELECT keep_id FROM (
      SELECT DISTINCT ON (convite_participacao_id) id AS keep_id
      FROM events
      WHERE convite_participacao_id IS NOT NULL
        AND COALESCE(ativo, true) = true
      ORDER BY convite_participacao_id, created_at ASC
    ) k
  );

CREATE INDEX IF NOT EXISTS idx_events_convite_participacao
  ON public.events (convite_participacao_id)
  WHERE convite_participacao_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
