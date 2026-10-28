-- Interesse em oportunidade só grava o convite.
-- O evento da agenda, com os dois artistas, nasce quando o dono aceita.
-- Rode no SQL Editor do Supabase.

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
  v_funcao TEXT;
  v_nome TEXT;
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

  v_funcao := COALESCE(v_funcao, public.feed_funcoes_para_despesa(v_event.feed_funcoes), 'Participação');
  v_nome := COALESCE(NULLIF(trim(v_event.name), ''), NULLIF(trim(coalesce(p_nome_evento, '')), ''), 'Oportunidade');

  IF EXISTS (
    SELECT 1
    FROM convite_participacao_evento c
    WHERE c.status IN ('pendente', 'aceito')
      AND (c.evento_origem_id = v_event.id OR c.grupo_disputa_id = v_event.id)
      AND c.artista_convidado_id = p_artista_interessado_id
  ) THEN
    RETURN QUERY SELECT false, 'Você já enviou uma proposta neste anúncio.', NULL::UUID, NULL::NUMERIC, NULL::TEXT;
    RETURN;
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
    v_event.id,
    v_event.artist_id,
    p_artista_interessado_id,
    'pendente',
    NULLIF(trim(coalesce(p_mensagem, '')), ''),
    v_nome,
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

GRANT EXECUTE ON FUNCTION public.rpc_app_iniciar_negociacao_feed(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_desfazer_proposta_feed(
  p_evento_id UUID,
  p_artista_interessado_id UUID
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
  v_convite convite_participacao_evento%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.';
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(
    v_uid,
    p_artista_interessado_id,
    ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para desfazer esta proposta.';
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM events e
  WHERE e.id = p_evento_id
    AND e.feed_tipo IS NOT NULL
  LIMIT 1;

  IF v_event.id IS NULL THEN
    RETURN QUERY SELECT false, 'Anúncio não encontrado.';
    RETURN;
  END IF;

  IF v_event.artist_id = p_artista_interessado_id THEN
    RETURN QUERY SELECT false, 'Este anúncio é do seu artista.';
    RETURN;
  END IF;

  SELECT * INTO v_convite
  FROM convite_participacao_evento c
  WHERE c.status = 'pendente'
    AND (c.grupo_disputa_id = v_event.id OR c.evento_origem_id = v_event.id)
    AND c.artista_convidado_id = p_artista_interessado_id
  ORDER BY c.criado_em DESC
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Nenhuma proposta sua foi encontrada neste anúncio.';
    RETURN;
  END IF;

  UPDATE convite_participacao_evento
  SET
    status = 'cancelado',
    motivo_cancelamento = 'Proposta desfeita pelo interessado.',
    respondido_em = NOW(),
    atualizado_em = NOW()
  WHERE id = v_convite.id
    AND status = 'pendente';

  UPDATE public.notifications n
  SET
    read = true,
    title = 'Proposta retirada',
    message = 'A proposta para "' || COALESCE(v_convite.nome_evento, v_event.name, 'este anúncio') ||
      '" foi desfeita. Não é mais necessário responder.'
  WHERE n.convite_participacao_evento_id = v_convite.id;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_desfazer_proposta_feed(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_propostas_feed_marketplace(
  p_artista_atual_id UUID
)
RETURNS TABLE (
  evento_id UUID,
  convite_id UUID,
  artista_id UUID,
  artista_nome TEXT,
  artista_image TEXT,
  funcao TEXT,
  status TEXT,
  mensagem TEXT,
  criado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.encerrar_anuncios_feed_vencidos();

  RETURN QUERY
  SELECT
    e.id,
    c.id,
    a.id,
    a.name,
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    NULLIF(trim(COALESCE(c.funcao_participacao, '')), ''),
    c.status,
    NULLIF(trim(COALESCE(c.mensagem, '')), ''),
    c.criado_em
  FROM events e
  INNER JOIN convite_participacao_evento c
    ON (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
  INNER JOIN artists a ON a.id = c.artista_convidado_id
  WHERE e.feed_tipo IS NOT NULL
    AND COALESCE(e.ativo, true) = true
    AND e.event_date >= public.feed_data_hoje_brasil()
    AND c.status IN ('pendente', 'aceito')
    AND p_artista_atual_id IS NOT NULL
    AND e.artist_id = p_artista_atual_id
  ORDER BY c.criado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_propostas_feed_marketplace(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_propostas_feed_marketplace(UUID) TO service_role;

-- No aceite, a oportunidade vira o evento do dono.
-- A cópia na agenda de quem teve interesse continua sendo criada no aceite do convite.
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
      AND feed_tipo IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
