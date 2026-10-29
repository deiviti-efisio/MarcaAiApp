-- Parceria do feed: interessado não edita (só cancela), some da agenda dos dois
-- e avisa com notificação clara.
-- Rode no SQL Editor após FEED_MARKETPLACE_PATCH_AGENDA_APOS_ACEITE.sql
-- e FUNCOES_CONVITE_PARTICIPACAO_EVENTO_RPC.sql.

-- Um convite de parceria vive em DUAS agendas. Índices únicos antigos
-- quebravam o UPDATE do interessado (um convite = um evento ativo).
DROP INDEX IF EXISTS public.idx_events_convite_participacao_unico;
DROP INDEX IF EXISTS public.idx_events_um_ativo_por_convite;
CREATE INDEX IF NOT EXISTS idx_events_convite_participacao
  ON public.events (convite_participacao_id)
  WHERE convite_participacao_id IS NOT NULL;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS parceria_feed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.convite_participacao_evento.parceria_feed IS
  'True quando o aceite veio de oportunidade do feed. Cancelar tira a data da agenda dos dois.';

-- Convites em que origem ≠ listing (oferta / estou livre).
UPDATE public.convite_participacao_evento
SET parceria_feed = true
WHERE grupo_disputa_id IS DISTINCT FROM evento_origem_id;

-- Destrava o evento de quem convidou, se um aceite antigo marcou como cópia do convidado.
UPDATE public.events e
SET convite_participacao_id = NULL,
    updated_at = NOW()
FROM public.convite_participacao_evento c
WHERE e.convite_participacao_id = c.id
  AND e.id = c.evento_origem_id
  AND e.artist_id = c.artista_que_convidou_id;

CREATE OR REPLACE FUNCTION public._notify_membros_artista(
  p_artist_id UUID,
  p_from_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_convite_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
  v_count INT := 0;
BEGIN
  FOR v_user IN
    SELECT am.user_id
    FROM public.artist_members am
    WHERE am.artist_id = p_artist_id
      AND am.role IN ('admin', 'owner', 'vendedor')
  LOOP
    PERFORM public._notify_participacao_evento(
      v_user,
      p_from_user_id,
      p_artist_id,
      p_title,
      p_message,
      p_convite_id
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    SELECT am.user_id INTO v_user
    FROM public.artist_members am
    WHERE am.artist_id = p_artist_id
    ORDER BY CASE am.role
      WHEN 'owner' THEN 1
      WHEN 'admin' THEN 2
      ELSE 9
    END
    LIMIT 1;
    IF v_user IS NOT NULL THEN
      PERFORM public._notify_participacao_evento(
        v_user,
        p_from_user_id,
        p_artist_id,
        p_title,
        p_message,
        p_convite_id
      );
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._encerrar_eventos_parceria(p_convite convite_participacao_evento, p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_convite.evento_criado_convidado_id IS NOT NULL THEN
    UPDATE public.events
    SET ativo = false, update_ativo = NOW(), updated_at = NOW(), updated_by = p_uid
    WHERE id = p_convite.evento_criado_convidado_id
      AND COALESCE(ativo, true) = true;
  END IF;

  IF COALESCE(p_convite.parceria_feed, false)
    OR p_convite.evento_origem_id IS DISTINCT FROM p_convite.grupo_disputa_id
  THEN
    UPDATE public.events
    SET ativo = false, update_ativo = NOW(), updated_at = NOW(), updated_by = p_uid
    WHERE id = p_convite.evento_origem_id
      AND COALESCE(ativo, true) = true;

    UPDATE public.events
    SET ativo = false, update_ativo = NOW(), updated_at = NOW(), updated_by = p_uid, feed_tipo = NULL
    WHERE id = p_convite.grupo_disputa_id
      AND COALESCE(ativo, true) = true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._mensagem_interessado_cancelou(
  p_artista_remetente UUID,
  p_artista_destinatario UUID,
  p_texto TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_low UUID;
  v_high UUID;
  v_id UUID;
  v_body TEXT;
BEGIN
  IF to_regclass('public.artist_conversations') IS NULL
    OR to_regclass('public.artist_messages') IS NULL THEN
    RETURN;
  END IF;
  IF p_artista_remetente IS NULL OR p_artista_destinatario IS NULL THEN
    RETURN;
  END IF;
  IF p_artista_remetente = p_artista_destinatario THEN
    RETURN;
  END IF;
  v_body := left(trim(COALESCE(p_texto, '')), 2000);
  IF v_body = '' THEN
    RETURN;
  END IF;
  v_low := LEAST(p_artista_remetente, p_artista_destinatario);
  v_high := GREATEST(p_artista_remetente, p_artista_destinatario);

  SELECT c.id INTO v_id
  FROM public.artist_conversations c
  WHERE c.artist_low = v_low AND c.artist_high = v_high;

  IF v_id IS NULL THEN
    INSERT INTO public.artist_conversations (artist_low, artist_high)
    VALUES (v_low, v_high)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.artist_messages (conversation_id, sender_artist_id, body)
  VALUES (v_id, p_artista_remetente, v_body);

  UPDATE public.artist_conversations
  SET last_message = v_body, last_message_at = now()
  WHERE id = v_id;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_feed_apos_aceitar_convite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_era_feed BOOLEAN := false;
BEGIN
  IF NEW.status = 'aceito' AND OLD.status IS DISTINCT FROM 'aceito' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id IN (NEW.evento_origem_id, NEW.grupo_disputa_id)
        AND e.feed_tipo IN ('disponivel', 'demanda')
    ) INTO v_era_feed;

    IF v_era_feed OR NEW.evento_origem_id IS DISTINCT FROM NEW.grupo_disputa_id THEN
      UPDATE public.convite_participacao_evento
      SET parceria_feed = true
      WHERE id = NEW.id;
    END IF;

    UPDATE public.events
    SET feed_tipo = NULL, confirmed = true, ativo = true, updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND feed_tipo = 'demanda'
      AND COALESCE(ativo, true) = true;

    UPDATE public.events
    SET ativo = true, confirmed = true, updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND feed_tipo IS NULL
      AND artist_id = NEW.artista_que_convidou_id;

    UPDATE public.events
    SET ativo = false, update_ativo = NOW(), feed_tipo = NULL, updated_at = NOW()
    WHERE id = NEW.grupo_disputa_id
      AND feed_tipo = 'disponivel'
      AND COALESCE(ativo, true) = true;

    -- Só trava a cópia de quem foi convidado. O evento de quem convidou continua editável.
    IF NEW.evento_origem_id IS DISTINCT FROM NEW.grupo_disputa_id THEN
      UPDATE public.events
      SET convite_participacao_id = NEW.id, updated_at = NOW()
      WHERE id = NEW.evento_origem_id
        AND artist_id = NEW.artista_convidado_id
        AND artist_id IS DISTINCT FROM NEW.artista_que_convidou_id
        AND convite_participacao_id IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_apos_aceitar_convite ON public.convite_participacao_evento;
CREATE TRIGGER trg_feed_apos_aceitar_convite
  AFTER UPDATE OF status ON public.convite_participacao_evento
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feed_apos_aceitar_convite();

CREATE OR REPLACE FUNCTION public.rpc_cancelar_participacao_aceita_evento(
  p_convite_id UUID,
  p_motivo TEXT
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
  v_convite convite_participacao_evento%ROWTYPE;
  v_nome TEXT;
  v_e_convidado BOOLEAN;
  v_e_interessado BOOLEAN;
  v_artista_interessado UUID;
  v_artista_anunciante UUID;
  v_cancela_interessado BOOLEAN;
  v_titulo TEXT;
  v_msg TEXT;
  v_notify_artist UUID;
  v_remetente UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.';
    RETURN;
  END IF;

  IF NULLIF(TRIM(p_motivo), '') IS NULL THEN
    RETURN QUERY SELECT false, 'Motivo do cancelamento é obrigatório.';
    RETURN;
  END IF;

  SELECT * INTO v_convite
  FROM convite_participacao_evento
  WHERE id = p_convite_id
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Convite não encontrado.';
    RETURN;
  END IF;

  IF v_convite.status <> 'aceito' THEN
    RETURN QUERY SELECT false, 'Somente participações aceitas podem ser canceladas.';
    RETURN;
  END IF;

  v_e_convidado := public._is_member_of_artist(
    v_uid, v_convite.artista_convidado_id, ARRAY['editor', 'vendedor', 'admin', 'owner']
  );
  v_e_interessado := public._is_member_of_artist(
    v_uid, v_convite.artista_que_convidou_id, ARRAY['editor', 'vendedor', 'admin', 'owner']
  );

  IF NOT v_e_convidado AND NOT v_e_interessado THEN
    RETURN QUERY SELECT false, 'Sem permissão para cancelar esta participação.';
    RETURN;
  END IF;

  IF v_convite.despesa_origem_id IS NOT NULL THEN
    DELETE FROM event_expenses WHERE id = v_convite.despesa_origem_id;
  END IF;

  PERFORM public._encerrar_eventos_parceria(v_convite, v_uid);

  UPDATE convite_participacao_evento
  SET
    status = 'cancelado',
    motivo_cancelamento = TRIM(p_motivo),
    respondido_em = NOW(),
    atualizado_em = NOW()
  WHERE id = v_convite.id
    AND status = 'aceito';

  IF v_convite.evento_origem_id IS DISTINCT FROM v_convite.grupo_disputa_id THEN
    v_artista_interessado := v_convite.artista_que_convidou_id;
    v_artista_anunciante := v_convite.artista_convidado_id;
  ELSE
    v_artista_interessado := v_convite.artista_convidado_id;
    v_artista_anunciante := v_convite.artista_que_convidou_id;
  END IF;

  v_cancela_interessado := public._is_member_of_artist(
    v_uid, v_artista_interessado, ARRAY['editor', 'vendedor', 'admin', 'owner']
  );

  IF COALESCE(v_convite.parceria_feed, false)
    OR v_convite.evento_origem_id IS DISTINCT FROM v_convite.grupo_disputa_id
  THEN
    IF v_cancela_interessado THEN
      SELECT name INTO v_nome FROM artists WHERE id = v_artista_interessado LIMIT 1;
      v_titulo := 'O interessado cancelou a parceria';
      v_msg := 'O interessado '
        || COALESCE(v_nome, 'do show')
        || ' cancelou a parceria em "'
        || COALESCE(NULLIF(trim(v_convite.nome_evento), ''), 'o show')
        || '". A data saiu da agenda dos dois. Motivo: '
        || TRIM(p_motivo);
      v_notify_artist := v_artista_anunciante;
      v_remetente := v_artista_interessado;
    ELSE
      SELECT name INTO v_nome FROM artists WHERE id = v_artista_anunciante LIMIT 1;
      v_titulo := 'O anunciante cancelou a parceria';
      v_msg := COALESCE(v_nome, 'O anunciante')
        || ' cancelou a parceria em "'
        || COALESCE(NULLIF(trim(v_convite.nome_evento), ''), 'o show')
        || '". A data saiu da agenda dos dois. Motivo: '
        || TRIM(p_motivo);
      v_notify_artist := v_artista_interessado;
      v_remetente := v_artista_anunciante;
    END IF;
  ELSE
    SELECT name INTO v_nome FROM artists WHERE id = v_convite.artista_convidado_id LIMIT 1;
    v_titulo := 'Participação cancelada pelo convidado';
    v_msg := COALESCE(v_nome, 'O artista convidado')
      || ' cancelou a participação no evento "'
      || COALESCE(NULLIF(trim(v_convite.nome_evento), ''), 'o show')
      || '". Motivo: '
      || TRIM(p_motivo);
    v_notify_artist := v_convite.artista_que_convidou_id;
    v_remetente := v_convite.artista_convidado_id;
  END IF;

  PERFORM public._notify_membros_artista(
    v_notify_artist,
    v_uid,
    v_titulo,
    v_msg,
    v_convite.id
  );

  IF v_cancela_interessado
    OR COALESCE(v_convite.parceria_feed, false)
    OR v_convite.evento_origem_id IS DISTINCT FROM v_convite.grupo_disputa_id
  THEN
    PERFORM public._mensagem_interessado_cancelou(
      v_remetente,
      v_notify_artist,
      v_msg
    );
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_cancelar_participacao_aceita_pelo_anfitriao_evento(
  p_convite_id UUID,
  p_motivo TEXT
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
  v_convite convite_participacao_evento%ROWTYPE;
  v_nome TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.';
    RETURN;
  END IF;

  IF NULLIF(TRIM(p_motivo), '') IS NULL THEN
    RETURN QUERY SELECT false, 'Motivo da remoção é obrigatório.';
    RETURN;
  END IF;

  SELECT * INTO v_convite
  FROM convite_participacao_evento
  WHERE id = p_convite_id
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Convite não encontrado.';
    RETURN;
  END IF;

  IF v_convite.status <> 'aceito' THEN
    RETURN QUERY SELECT false, 'Somente participações já aceitas podem ser removidas pelo organizador.';
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(
    v_uid, v_convite.artista_que_convidou_id, ARRAY['editor', 'vendedor', 'admin', 'owner']
  ) THEN
    RETURN QUERY SELECT false, 'Sem permissão para remover esta participação.';
    RETURN;
  END IF;

  IF v_convite.despesa_origem_id IS NOT NULL THEN
    DELETE FROM event_expenses WHERE id = v_convite.despesa_origem_id;
  END IF;

  PERFORM public._encerrar_eventos_parceria(v_convite, v_uid);

  UPDATE convite_participacao_evento
  SET
    status = 'cancelado',
    motivo_cancelamento = TRIM(p_motivo),
    respondido_em = NOW(),
    atualizado_em = NOW()
  WHERE id = v_convite.id
    AND status = 'aceito';

  SELECT name INTO v_nome FROM artists WHERE id = v_convite.artista_que_convidou_id LIMIT 1;

  PERFORM public._notify_membros_artista(
    v_convite.artista_convidado_id,
    v_uid,
    'Parceria cancelada pelo anunciante',
    COALESCE(v_nome, 'O anunciante')
      || ' cancelou a parceria em "'
      || COALESCE(NULLIF(trim(v_convite.nome_evento), ''), 'o show')
      || '". A data saiu da agenda dos dois. Motivo: '
      || TRIM(p_motivo),
    v_convite.id
  );

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_cancelar_participacao_aceita_evento(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_participacao_aceita_pelo_anfitriao_evento(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public._notify_membros_artista(UUID, UUID, TEXT, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
