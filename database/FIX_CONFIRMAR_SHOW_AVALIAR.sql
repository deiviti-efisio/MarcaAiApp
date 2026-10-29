-- Rode este arquivo no SQL Editor do Supabase.
-- Cria rpc_app_confirmar_show_e_avaliar com notas INTEGER (o app envia número JSON).
-- Não rode o FEED_REPUTACAO_SHOW_CONFIRMADO.sql inteiro.

-- =====================================================
-- 1) Confirmação de realização do show no convite
-- =====================================================
ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_em TIMESTAMPTZ;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Avaliações antigas (antes deste patch) continuam valendo como show confirmado
UPDATE public.convite_participacao_evento c
SET
  show_confirmado = true,
  show_confirmado_em = COALESCE(c.show_confirmado_em, a.criado_em),
  show_confirmado_por = COALESCE(c.show_confirmado_por, c.usuario_que_enviou_id)
FROM public.participacao_evento_avaliacoes a
WHERE a.convite_participacao_evento_id = c.id
  AND c.show_confirmado = false;

-- =====================================================
-- 2) Confirmar show + avaliar (ação única do contratante)
-- =====================================================
DROP FUNCTION IF EXISTS public.rpc_app_confirmar_show_e_avaliar(UUID, SMALLINT, BOOLEAN, SMALLINT, SMALLINT, SMALLINT, SMALLINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_app_confirmar_show_e_avaliar(UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_app_confirmar_show_e_avaliar(
  p_convite_id UUID,
  p_nota_geral INTEGER,
  p_confirmar_show BOOLEAN DEFAULT true,
  p_nota_pontualidade INTEGER DEFAULT NULL,
  p_nota_profissionalismo INTEGER DEFAULT NULL,
  p_nota_qualidade_tecnica INTEGER DEFAULT NULL,
  p_nota_comunicacao INTEGER DEFAULT NULL,
  p_comentario_publico TEXT DEFAULT NULL,
  p_observacao_privada TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT,
  avaliacao_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_convite public.convite_participacao_evento%ROWTYPE;
  v_avaliacao_id UUID;
  v_ja_confirmado BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Usuário não autenticado.', NULL::UUID;
    RETURN;
  END IF;

  IF p_nota_geral IS NULL OR p_nota_geral < 1 OR p_nota_geral > 5 THEN
    RETURN QUERY SELECT false, 'A nota geral deve estar entre 1 e 5.', NULL::UUID;
    RETURN;
  END IF;

  SELECT *
    INTO v_convite
  FROM public.convite_participacao_evento c
  WHERE c.id = p_convite_id
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Convite não encontrado.', NULL::UUID;
    RETURN;
  END IF;

  IF v_convite.status <> 'aceito' THEN
    RETURN QUERY SELECT false, 'Somente convites aceitos podem ser confirmados.', NULL::UUID;
    RETURN;
  END IF;

  IF v_convite.data_evento >= CURRENT_DATE THEN
    RETURN QUERY SELECT false, 'A confirmação é liberada somente após a data do show (D+1).', NULL::UUID;
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(v_uid, v_convite.artista_que_convidou_id, ARRAY['editor', 'admin', 'owner']) THEN
    RETURN QUERY SELECT false, 'Sem permissão para confirmar este show.', NULL::UUID;
    RETURN;
  END IF;

  v_ja_confirmado := COALESCE(v_convite.show_confirmado, false);

  IF NOT v_ja_confirmado AND COALESCE(p_confirmar_show, false) IS NOT TRUE THEN
    RETURN QUERY SELECT false, 'Confirme que o show aconteceu para registrar a avaliação.', NULL::UUID;
    RETURN;
  END IF;

  IF NOT v_ja_confirmado THEN
    UPDATE public.convite_participacao_evento
    SET
      show_confirmado = true,
      show_confirmado_em = NOW(),
      show_confirmado_por = v_uid,
      atualizado_em = NOW()
    WHERE id = v_convite.id;
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
    comentario_publico,
    observacao_privada
  )
  VALUES (
    v_convite.id,
    v_convite.evento_origem_id,
    v_convite.artista_que_convidou_id,
    v_convite.artista_convidado_id,
    p_nota_geral,
    p_nota_pontualidade,
    p_nota_profissionalismo,
    p_nota_qualidade_tecnica,
    p_nota_comunicacao,
    NULLIF(TRIM(COALESCE(p_comentario_publico, '')), ''),
    NULLIF(TRIM(COALESCE(p_observacao_privada, '')), '')
  )
  ON CONFLICT (convite_participacao_evento_id)
  DO UPDATE SET
    nota_geral = EXCLUDED.nota_geral,
    nota_pontualidade = EXCLUDED.nota_pontualidade,
    nota_profissionalismo = EXCLUDED.nota_profissionalismo,
    nota_qualidade_tecnica = EXCLUDED.nota_qualidade_tecnica,
    nota_comunicacao = EXCLUDED.nota_comunicacao,
    comentario_publico = EXCLUDED.comentario_publico,
    observacao_privada = EXCLUDED.observacao_privada,
    atualizado_em = NOW()
  RETURNING id INTO v_avaliacao_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_avaliacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_confirmar_show_e_avaliar(
  UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

