-- Ciclo de contratação: status, cancelamento combinado, confirmação bilateral e avaliação dos dois lados.
-- Rode no SQL Editor após AVALIACAO_PARTICIPACAO_EVENTO.sql, FEED_REPUTACAO_SHOW_CONFIRMADO.sql
-- e FEED_PARCERIA_CANCELAR_AMBOS.sql.

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS ciclo_status TEXT;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_anfitriao BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_convidado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_anfitriao_em TIMESTAMPTZ;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_convidado_em TIMESTAMPTZ;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS condicoes_pagamento TEXT;

UPDATE public.convite_participacao_evento
SET ciclo_status = CASE
  WHEN status = 'pendente' THEN 'pending_confirmation'
  WHEN status = 'aceito' AND COALESCE(show_confirmado, false) THEN 'completed'
  WHEN status = 'aceito' THEN 'confirmed'
  WHEN status = 'cancelado' THEN 'cancelled'
  WHEN status = 'recusado' THEN 'cancelled'
  ELSE 'pending_confirmation'
END
WHERE ciclo_status IS NULL;

UPDATE public.convite_participacao_evento
SET
  show_confirmado_anfitriao = COALESCE(show_confirmado, false),
  show_confirmado_anfitriao_em = CASE
    WHEN COALESCE(show_confirmado, false) THEN COALESCE(show_confirmado_em, NOW())
    ELSE show_confirmado_anfitriao_em
  END
WHERE COALESCE(show_confirmado, false) = true
  AND COALESCE(show_confirmado_anfitriao, false) = false;

CREATE TABLE IF NOT EXISTS public.contratacao_cancelamento_solicitacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convite_id UUID NOT NULL REFERENCES public.convite_participacao_evento(id) ON DELETE CASCADE,
  solicitado_por_artista_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  descricao TEXT,
  pagamento_info TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'contested')),
  respondido_por_artista_id UUID REFERENCES public.artists(id) ON DELETE SET NULL,
  resposta_nota TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  respondido_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contratacao_cancel_convite
  ON public.contratacao_cancelamento_solicitacoes (convite_id, criado_em DESC);

ALTER TABLE public.contratacao_cancelamento_solicitacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contratacao_cancel_select ON public.contratacao_cancelamento_solicitacoes;
CREATE POLICY contratacao_cancel_select ON public.contratacao_cancelamento_solicitacoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.convite_participacao_evento c
      WHERE c.id = convite_id
        AND (
          public._is_member_of_artist(auth.uid(), c.artista_que_convidou_id, NULL)
          OR public._is_member_of_artist(auth.uid(), c.artista_convidado_id, NULL)
        )
    )
  );

ALTER TABLE public.participacao_evento_avaliacoes
  DROP CONSTRAINT IF EXISTS participacao_evento_avaliacoes_convite_participacao_evento_id_key;
DROP INDEX IF EXISTS public.participacao_evento_avaliacoes_convite_participacao_evento_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_avaliacao_uma_por_avaliador
  ON public.participacao_evento_avaliacoes (convite_participacao_evento_id, artista_avaliador_id);

CREATE OR REPLACE FUNCTION public.rpc_app_estatisticas_perfil_artista(p_artista_id UUID)
RETURNS TABLE (
  shows_realizados INT,
  contratantes_atendidos INT,
  media_nota NUMERIC,
  total_avaliacoes INT,
  parcerias_aceitas INT,
  parcerias_concluidas INT,
  taxa_conclusao NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH aceitas AS (
    SELECT c.id, c.status, c.ciclo_status, c.show_confirmado,
           c.artista_que_convidou_id, c.artista_convidado_id
    FROM public.convite_participacao_evento c
    WHERE c.artista_convidado_id = p_artista_id
       OR c.artista_que_convidou_id = p_artista_id
  ),
  av AS (
    SELECT a.nota_geral, a.artista_avaliador_id
    FROM public.participacao_evento_avaliacoes a
    JOIN public.convite_participacao_evento c ON c.id = a.convite_participacao_evento_id
    WHERE a.artista_avaliado_id = p_artista_id
      AND c.status = 'aceito'
      AND COALESCE(c.show_confirmado, false) = true
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM av), 0)::int,
    COALESCE((SELECT COUNT(DISTINCT artista_avaliador_id) FROM av), 0)::int,
    (SELECT ROUND(AVG(nota_geral)::numeric, 2) FROM av),
    COALESCE((SELECT COUNT(*) FROM av), 0)::int,
    COALESCE((SELECT COUNT(*) FROM aceitas WHERE status = 'aceito'), 0)::int,
    COALESCE((
      SELECT COUNT(*) FROM aceitas
      WHERE COALESCE(show_confirmado, false)
         OR ciclo_status = 'completed'
    ), 0)::int,
    CASE
      WHEN COALESCE((SELECT COUNT(*) FROM aceitas WHERE status IN ('aceito', 'cancelado')), 0) = 0 THEN NULL
      ELSE ROUND(
        (
          COALESCE((
            SELECT COUNT(*) FROM aceitas
            WHERE COALESCE(show_confirmado, false) OR ciclo_status = 'completed'
          ), 0)::numeric
          / NULLIF((SELECT COUNT(*) FROM aceitas WHERE status IN ('aceito', 'cancelado')), 0)::numeric
        ) * 100
      , 0)
    END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_estatisticas_perfil_artista(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_obter_contratacao(p_convite_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c public.convite_participacao_evento%ROWTYPE;
  v_cancel JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Faça login.');
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = p_convite_id;
  IF v_c.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contratação não encontrada.');
  END IF;
  IF NOT (
    public._is_member_of_artist(v_uid, v_c.artista_que_convidou_id, NULL)
    OR public._is_member_of_artist(v_uid, v_c.artista_convidado_id, NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'solicitado_por_artista_id', s.solicitado_por_artista_id,
    'motivo', s.motivo,
    'descricao', s.descricao,
    'pagamento_info', s.pagamento_info,
    'status', s.status,
    'respondido_por_artista_id', s.respondido_por_artista_id,
    'resposta_nota', s.resposta_nota,
    'criado_em', s.criado_em,
    'respondido_em', s.respondido_em
  ) ORDER BY s.criado_em DESC), '[]'::jsonb)
  INTO v_cancel
  FROM public.contratacao_cancelamento_solicitacoes s
  WHERE s.convite_id = v_c.id;

  RETURN jsonb_build_object(
    'success', true,
    'error', NULL,
    'contratacao', jsonb_build_object(
      'id', v_c.id,
      'ciclo_status', COALESCE(v_c.ciclo_status, CASE
        WHEN v_c.status = 'aceito' AND COALESCE(v_c.show_confirmado, false) THEN 'completed'
        WHEN v_c.status = 'aceito' THEN 'confirmed'
        WHEN v_c.status = 'cancelado' THEN 'cancelled'
        ELSE 'pending_confirmation'
      END),
      'status_convite', v_c.status,
      'artista_anfitriao_id', v_c.artista_que_convidou_id,
      'artista_convidado_id', v_c.artista_convidado_id,
      'nome_evento', v_c.nome_evento,
      'data_evento', v_c.data_evento,
      'hora_inicio', v_c.hora_inicio,
      'hora_fim', v_c.hora_fim,
      'cidade', v_c.cidade,
      'estado_uf', v_c.estado_uf,
      'cache_valor', v_c.cache_valor,
      'funcao_participacao', v_c.funcao_participacao,
      'condicoes_pagamento', v_c.condicoes_pagamento,
      'show_confirmado', COALESCE(v_c.show_confirmado, false),
      'show_confirmado_anfitriao', COALESCE(v_c.show_confirmado_anfitriao, false),
      'show_confirmado_convidado', COALESCE(v_c.show_confirmado_convidado, false),
      'respondido_em', v_c.respondido_em,
      'cancelamentos', v_cancel
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_obter_contratacao(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_solicitar_cancelamento_contratacao(
  p_convite_id UUID,
  p_motivo TEXT,
  p_descricao TEXT DEFAULT NULL,
  p_pagamento_info TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c public.convite_participacao_evento%ROWTYPE;
  v_artista UUID;
  v_outro UUID;
  v_nome TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login.';
    RETURN;
  END IF;
  IF NULLIF(trim(p_motivo), '') IS NULL THEN
    RETURN QUERY SELECT false, 'Informe o motivo do cancelamento.';
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = p_convite_id;
  IF v_c.id IS NULL THEN
    RETURN QUERY SELECT false, 'Contratação não encontrada.';
    RETURN;
  END IF;
  IF v_c.status <> 'aceito' THEN
    RETURN QUERY SELECT false, 'Só dá para cancelar uma contratação confirmada.';
    RETURN;
  END IF;
  IF COALESCE(v_c.ciclo_status, 'confirmed') IN ('cancelled', 'cancelled_by_mutual_agreement', 'completed') THEN
    RETURN QUERY SELECT false, 'Esta contratação não pode mais ser cancelada.';
    RETURN;
  END IF;

  IF public._is_member_of_artist(v_uid, v_c.artista_que_convidou_id, ARRAY['editor', 'vendedor', 'admin', 'owner']) THEN
    v_artista := v_c.artista_que_convidou_id;
    v_outro := v_c.artista_convidado_id;
  ELSIF public._is_member_of_artist(v_uid, v_c.artista_convidado_id, ARRAY['editor', 'vendedor', 'admin', 'owner']) THEN
    v_artista := v_c.artista_convidado_id;
    v_outro := v_c.artista_que_convidou_id;
  ELSE
    RETURN QUERY SELECT false, 'Sem permissão.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contratacao_cancelamento_solicitacoes s
    WHERE s.convite_id = v_c.id AND s.status = 'pending'
  ) THEN
    RETURN QUERY SELECT false, 'Já existe um cancelamento aguardando resposta.';
    RETURN;
  END IF;

  INSERT INTO public.contratacao_cancelamento_solicitacoes (
    convite_id, solicitado_por_artista_id, motivo, descricao, pagamento_info, status
  ) VALUES (
    v_c.id, v_artista, trim(p_motivo), NULLIF(trim(COALESCE(p_descricao, '')), ''),
    NULLIF(trim(COALESCE(p_pagamento_info, '')), ''), 'pending'
  );

  UPDATE public.convite_participacao_evento
  SET ciclo_status = 'cancellation_requested', atualizado_em = NOW()
  WHERE id = v_c.id;

  SELECT name INTO v_nome FROM public.artists WHERE id = v_artista;
  PERFORM public._notify_membros_artista(
    v_outro,
    v_uid,
    'Cancelamento solicitado',
    COALESCE(v_nome, 'A outra parte')
      || ' pediu para cancelar "'
      || COALESCE(NULLIF(trim(v_c.nome_evento), ''), 'o show')
      || '". Motivo: '
      || trim(p_motivo)
      || '. Abra a contratação para aceitar ou contestar.',
    v_c.id
  );

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_solicitar_cancelamento_contratacao(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_responder_cancelamento_contratacao(
  p_solicitacao_id UUID,
  p_aceitar BOOLEAN,
  p_nota TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_s public.contratacao_cancelamento_solicitacoes%ROWTYPE;
  v_c public.convite_participacao_evento%ROWTYPE;
  v_artista UUID;
  v_nome TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login.';
    RETURN;
  END IF;

  SELECT * INTO v_s FROM public.contratacao_cancelamento_solicitacoes WHERE id = p_solicitacao_id;
  IF v_s.id IS NULL OR v_s.status <> 'pending' THEN
    RETURN QUERY SELECT false, 'Solicitação indisponível.';
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = v_s.convite_id;

  IF v_s.solicitado_por_artista_id = v_c.artista_que_convidou_id THEN
    v_artista := v_c.artista_convidado_id;
  ELSE
    v_artista := v_c.artista_que_convidou_id;
  END IF;

  IF NOT public._is_member_of_artist(v_uid, v_artista, ARRAY['editor', 'vendedor', 'admin', 'owner']) THEN
    RETURN QUERY SELECT false, 'Só a outra parte pode responder.';
    RETURN;
  END IF;

  UPDATE public.contratacao_cancelamento_solicitacoes
  SET
    status = CASE WHEN p_aceitar THEN 'accepted' ELSE 'contested' END,
    respondido_por_artista_id = v_artista,
    resposta_nota = NULLIF(trim(COALESCE(p_nota, '')), ''),
    respondido_em = NOW()
  WHERE id = v_s.id;

  SELECT name INTO v_nome FROM public.artists WHERE id = v_artista;

  IF p_aceitar THEN
    UPDATE public.convite_participacao_evento
    SET
      status = 'cancelado',
      ciclo_status = 'cancelled_by_mutual_agreement',
      motivo_cancelamento = v_s.motivo,
      respondido_em = NOW(),
      atualizado_em = NOW()
    WHERE id = v_c.id AND status = 'aceito';

    PERFORM public._encerrar_eventos_parceria(v_c, v_uid);

    PERFORM public._notify_membros_artista(
      v_s.solicitado_por_artista_id,
      v_uid,
      'Cancelamento aceito',
      COALESCE(v_nome, 'A outra parte')
        || ' aceitou o cancelamento de "'
        || COALESCE(NULLIF(trim(v_c.nome_evento), ''), 'o show')
        || '". A data saiu da agenda dos dois.',
      v_c.id
    );
  ELSE
    UPDATE public.convite_participacao_evento
    SET ciclo_status = 'under_review', atualizado_em = NOW()
    WHERE id = v_c.id;

    PERFORM public._notify_membros_artista(
      v_s.solicitado_por_artista_id,
      v_uid,
      'Cancelamento contestado',
      COALESCE(v_nome, 'A outra parte')
        || ' contestou o cancelamento de "'
        || COALESCE(NULLIF(trim(v_c.nome_evento), ''), 'o show')
        || '". A contratação ficou em análise. A data permanece na agenda.',
      v_c.id
    );
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_responder_cancelamento_contratacao(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_confirmar_realizacao_contratacao(p_convite_id UUID)
RETURNS TABLE (success BOOLEAN, error TEXT, ciclo_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c public.convite_participacao_evento%ROWTYPE;
  v_anfitriao BOOLEAN;
  v_both BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login.', NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = p_convite_id;
  IF v_c.id IS NULL OR v_c.status <> 'aceito' THEN
    RETURN QUERY SELECT false, 'Contratação não encontrada ou não confirmada.', NULL::TEXT;
    RETURN;
  END IF;
  IF COALESCE(v_c.ciclo_status, 'confirmed') IN ('cancelled', 'cancelled_by_mutual_agreement') THEN
    RETURN QUERY SELECT false, 'Contratação cancelada.', NULL::TEXT;
    RETURN;
  END IF;
  IF v_c.data_evento >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RETURN QUERY SELECT false, 'A confirmação de realização abre no dia seguinte ao show.', NULL::TEXT;
    RETURN;
  END IF;

  v_anfitriao := public._is_member_of_artist(v_uid, v_c.artista_que_convidou_id, ARRAY['editor', 'vendedor', 'admin', 'owner']);
  IF NOT v_anfitriao AND NOT public._is_member_of_artist(v_uid, v_c.artista_convidado_id, ARRAY['editor', 'vendedor', 'admin', 'owner']) THEN
    RETURN QUERY SELECT false, 'Sem permissão.', NULL::TEXT;
    RETURN;
  END IF;

  IF v_anfitriao THEN
    UPDATE public.convite_participacao_evento
    SET show_confirmado_anfitriao = true, show_confirmado_anfitriao_em = NOW(), atualizado_em = NOW()
    WHERE id = v_c.id;
  ELSE
    UPDATE public.convite_participacao_evento
    SET show_confirmado_convidado = true, show_confirmado_convidado_em = NOW(), atualizado_em = NOW()
    WHERE id = v_c.id;
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = p_convite_id;
  v_both := COALESCE(v_c.show_confirmado_anfitriao, false) AND COALESCE(v_c.show_confirmado_convidado, false);

  IF v_both THEN
    UPDATE public.convite_participacao_evento
    SET
      show_confirmado = true,
      show_confirmado_em = COALESCE(show_confirmado_em, NOW()),
      ciclo_status = 'completed',
      atualizado_em = NOW()
    WHERE id = v_c.id;
    RETURN QUERY SELECT true, NULL::TEXT, 'completed'::TEXT;
  ELSE
    UPDATE public.convite_participacao_evento
    SET ciclo_status = 'confirmed', atualizado_em = NOW()
    WHERE id = v_c.id AND COALESCE(ciclo_status, 'confirmed') NOT IN ('cancellation_requested', 'under_review');
    RETURN QUERY SELECT true, NULL::TEXT, 'confirmed'::TEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_confirmar_realizacao_contratacao(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_avaliar_parceiro_contratacao(
  p_convite_id UUID,
  p_nota_geral SMALLINT,
  p_nota_a SMALLINT DEFAULT NULL,
  p_nota_b SMALLINT DEFAULT NULL,
  p_nota_c SMALLINT DEFAULT NULL,
  p_nota_d SMALLINT DEFAULT NULL,
  p_comentario_publico TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error TEXT, avaliacao_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_c public.convite_participacao_evento%ROWTYPE;
  v_avaliador UUID;
  v_avaliado UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Faça login.', NULL::UUID;
    RETURN;
  END IF;
  IF p_nota_geral IS NULL OR p_nota_geral < 1 OR p_nota_geral > 5 THEN
    RETURN QUERY SELECT false, 'A nota geral deve estar entre 1 e 5.', NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.convite_participacao_evento WHERE id = p_convite_id;
  IF v_c.id IS NULL THEN
    RETURN QUERY SELECT false, 'Contratação não encontrada.', NULL::UUID;
    RETURN;
  END IF;
  IF v_c.status <> 'aceito' OR COALESCE(v_c.ciclo_status, '') IN ('cancelled', 'cancelled_by_mutual_agreement') THEN
    RETURN QUERY SELECT false, 'Eventos cancelados não podem ser avaliados.';
    RETURN;
  END IF;
  IF NOT COALESCE(v_c.show_confirmado, false) AND COALESCE(v_c.ciclo_status, '') <> 'completed' THEN
    RETURN QUERY SELECT false, 'Só dá para avaliar depois que as duas partes confirmarem que o show aconteceu.';
    RETURN;
  END IF;

  IF public._is_member_of_artist(v_uid, v_c.artista_que_convidou_id, ARRAY['editor', 'admin', 'owner']) THEN
    v_avaliador := v_c.artista_que_convidou_id;
    v_avaliado := v_c.artista_convidado_id;
  ELSIF public._is_member_of_artist(v_uid, v_c.artista_convidado_id, ARRAY['editor', 'admin', 'owner']) THEN
    v_avaliador := v_c.artista_convidado_id;
    v_avaliado := v_c.artista_que_convidou_id;
  ELSE
    RETURN QUERY SELECT false, 'Somente quem participou da contratação pode avaliar.';
    RETURN;
  END IF;

  INSERT INTO public.participacao_evento_avaliacoes (
    convite_participacao_evento_id,
    evento_origem_id,
    artista_avaliador_id,
    artista_avaliado_id,
    nota_geral,
    nota_pontualidade,
    nota_profissionalismo,
    nota_qualidade_tecnica,
    nota_comunicacao,
    comentario_publico
  ) VALUES (
    v_c.id,
    v_c.evento_origem_id,
    v_avaliador,
    v_avaliado,
    p_nota_geral,
    p_nota_a,
    p_nota_b,
    p_nota_c,
    p_nota_d,
    NULLIF(trim(COALESCE(p_comentario_publico, '')), '')
  )
  ON CONFLICT (convite_participacao_evento_id, artista_avaliador_id)
  DO UPDATE SET
    nota_geral = EXCLUDED.nota_geral,
    nota_pontualidade = EXCLUDED.nota_pontualidade,
    nota_profissionalismo = EXCLUDED.nota_profissionalismo,
    nota_qualidade_tecnica = EXCLUDED.nota_qualidade_tecnica,
    nota_comunicacao = EXCLUDED.nota_comunicacao,
    comentario_publico = EXCLUDED.comentario_publico,
    atualizado_em = NOW()
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'Você já avaliou esta contratação.', NULL::UUID;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_avaliar_parceiro_contratacao(UUID, SMALLINT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_avaliacoes_pendentes_artista(p_artista_id UUID)
RETURNS TABLE (
  convite_id UUID,
  nome_evento TEXT,
  data_evento DATE,
  outro_artista_id UUID,
  outro_artista_nome TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.id,
    c.nome_evento,
    c.data_evento,
    CASE WHEN c.artista_que_convidou_id = p_artista_id THEN c.artista_convidado_id ELSE c.artista_que_convidou_id END,
    COALESCE(a.name, 'Artista')
  FROM public.convite_participacao_evento c
  LEFT JOIN public.artists a ON a.id = CASE
    WHEN c.artista_que_convidou_id = p_artista_id THEN c.artista_convidado_id
    ELSE c.artista_que_convidou_id
  END
  WHERE public._is_member_of_artist(auth.uid(), p_artista_id, NULL)
    AND c.status = 'aceito'
    AND (COALESCE(c.show_confirmado, false) OR c.ciclo_status = 'completed')
    AND c.data_evento < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    AND NOT EXISTS (
      SELECT 1 FROM public.participacao_evento_avaliacoes av
      WHERE av.convite_participacao_evento_id = c.id
        AND av.artista_avaliador_id = p_artista_id
    )
    AND (c.artista_que_convidou_id = p_artista_id OR c.artista_convidado_id = p_artista_id);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_avaliacoes_pendentes_artista(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
