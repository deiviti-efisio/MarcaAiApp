-- Reputação no feed: confirmação de show + avaliação obrigatória para contar como realizado.
-- Rode no SQL Editor do Supabase após AVALIACAO_PARTICIPACAO_EVENTO.sql e FEED_MARKETPLACE*.sql

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

-- Mantém RPC antiga redirecionando para confirmação automática (retrocompat)
CREATE OR REPLACE FUNCTION public.rpc_app_salvar_avaliacao_participacao_evento(
  p_convite_id UUID,
  p_nota_geral SMALLINT,
  p_nota_pontualidade SMALLINT DEFAULT NULL,
  p_nota_profissionalismo SMALLINT DEFAULT NULL,
  p_nota_qualidade_tecnica SMALLINT DEFAULT NULL,
  p_nota_comunicacao SMALLINT DEFAULT NULL,
  p_comentario_publico TEXT DEFAULT NULL,
  p_observacao_privada TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error TEXT,
  avaliacao_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.rpc_app_confirmar_show_e_avaliar(
    p_convite_id => p_convite_id,
    p_nota_geral => p_nota_geral,
    p_confirmar_show => true,
    p_nota_pontualidade => p_nota_pontualidade,
    p_nota_profissionalismo => p_nota_profissionalismo,
    p_nota_qualidade_tecnica => p_nota_qualidade_tecnica,
    p_nota_comunicacao => p_nota_comunicacao,
    p_comentario_publico => p_comentario_publico,
    p_observacao_privada => p_observacao_privada
  );
$$;

-- =====================================================
-- 3) Resumos de reputação (só shows confirmados + avaliados)
-- =====================================================
CREATE OR REPLACE FUNCTION public.rpc_app_resumo_reputacao_artistas(
  p_artista_ids UUID[]
)
RETURNS TABLE (
  artista_id UUID,
  media_nota_geral NUMERIC(4,2),
  total_avaliacoes INT,
  shows_realizados INT,
  anuncios_feed_ativos INT,
  negociacoes_aceitas INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_artista_ids) AS artist_id
  ),
  avaliacoes_confirmadas AS (
    SELECT
      a.artista_avaliado_id,
      a.nota_geral
    FROM public.participacao_evento_avaliacoes a
    INNER JOIN public.convite_participacao_evento c
      ON c.id = a.convite_participacao_evento_id
    INNER JOIN ids i ON i.artist_id = a.artista_avaliado_id
    WHERE c.show_confirmado = true
      AND c.status = 'aceito'
  ),
  stats_avaliacao AS (
    SELECT
      ac.artista_avaliado_id,
      ROUND(AVG(ac.nota_geral)::numeric, 2) AS media_nota_geral,
      COUNT(*)::int AS total_avaliacoes,
      COUNT(*)::int AS shows_realizados
    FROM avaliacoes_confirmadas ac
    GROUP BY ac.artista_avaliado_id
  ),
  anuncios AS (
    SELECT
      e.artist_id,
      COUNT(*)::int AS anuncios_feed_ativos
    FROM public.events e
    INNER JOIN ids i ON i.artist_id = e.artist_id
    WHERE COALESCE(e.ativo, true) = true
      AND e.feed_tipo IS NOT NULL
      AND e.feed_tipo IN ('disponivel', 'demanda')
    GROUP BY e.artist_id
  ),
  negociacoes AS (
    SELECT
      i.artist_id,
      COUNT(*)::int AS negociacoes_aceitas
    FROM ids i
    INNER JOIN public.convite_participacao_evento c
      ON c.status = 'aceito'
      AND (
        c.artista_convidado_id = i.artist_id
        OR c.artista_que_convidou_id = i.artist_id
      )
    GROUP BY i.artist_id
  )
  SELECT
    i.artist_id,
    s.media_nota_geral,
    COALESCE(s.total_avaliacoes, 0) AS total_avaliacoes,
    COALESCE(s.shows_realizados, 0) AS shows_realizados,
    COALESCE(a.anuncios_feed_ativos, 0) AS anuncios_feed_ativos,
    COALESCE(n.negociacoes_aceitas, 0) AS negociacoes_aceitas
  FROM ids i
  LEFT JOIN stats_avaliacao s ON s.artista_avaliado_id = i.artist_id
  LEFT JOIN anuncios a ON a.artist_id = i.artist_id
  LEFT JOIN negociacoes n ON n.artist_id = i.artist_id;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_resumo_reputacao_artistas(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_app_resumo_avaliacoes_artistas_para_convite(
  p_artista_ids UUID[]
)
RETURNS TABLE (
  artista_avaliado_id UUID,
  media_nota_geral NUMERIC(4,2),
  total_avaliacoes INT,
  comentario_publico_recente TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_artista_ids) AS artist_id
  ),
  base AS (
    SELECT
      a.artista_avaliado_id,
      a.nota_geral,
      NULLIF(TRIM(COALESCE(a.comentario_publico, '')), '') AS comentario_publico,
      a.criado_em
    FROM public.participacao_evento_avaliacoes a
    INNER JOIN public.convite_participacao_evento c
      ON c.id = a.convite_participacao_evento_id
    INNER JOIN ids i ON i.artist_id = a.artista_avaliado_id
    WHERE c.show_confirmado = true
      AND c.status = 'aceito'
  ),
  stats AS (
    SELECT
      b.artista_avaliado_id,
      ROUND(AVG(b.nota_geral)::numeric, 2) AS media_nota_geral,
      COUNT(*)::int AS total_avaliacoes
    FROM base b
    GROUP BY b.artista_avaliado_id
  ),
  latest_comment AS (
    SELECT DISTINCT ON (b.artista_avaliado_id)
      b.artista_avaliado_id,
      b.comentario_publico AS comentario_publico_recente
    FROM base b
    WHERE b.comentario_publico IS NOT NULL
    ORDER BY b.artista_avaliado_id, b.criado_em DESC
  )
  SELECT
    i.artist_id AS artista_avaliado_id,
    s.media_nota_geral,
    COALESCE(s.total_avaliacoes, 0) AS total_avaliacoes,
    lc.comentario_publico_recente
  FROM ids i
  LEFT JOIN stats s ON s.artista_avaliado_id = i.artist_id
  LEFT JOIN latest_comment lc ON lc.artista_avaliado_id = i.artist_id;
$$;

DROP FUNCTION IF EXISTS public.rpc_app_listar_avaliacoes_publicas_artista(UUID, INT);

CREATE OR REPLACE FUNCTION public.rpc_app_listar_avaliacoes_publicas_artista(
  p_artista_avaliado_id UUID,
  p_limite INT DEFAULT 30
)
RETURNS TABLE (
  nota_geral SMALLINT,
  comentario_publico TEXT,
  criado_em TIMESTAMPTZ,
  artista_avaliador_id UUID,
  artista_avaliador_nome TEXT,
  artista_avaliador_imagem TEXT,
  nome_evento TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.nota_geral,
    a.comentario_publico,
    a.criado_em,
    a.artista_avaliador_id,
    COALESCE(av.name, 'Artista') AS artista_avaliador_nome,
    NULLIF(TRIM(COALESCE(av.profile_url, '')), '') AS artista_avaliador_imagem,
    c.nome_evento
  FROM public.participacao_evento_avaliacoes a
  INNER JOIN public.convite_participacao_evento c
    ON c.id = a.convite_participacao_evento_id
  LEFT JOIN public.artists av
    ON av.id = a.artista_avaliador_id
  WHERE a.artista_avaliado_id = p_artista_avaliado_id
    AND c.show_confirmado = true
    AND c.status = 'aceito'
    AND NULLIF(TRIM(COALESCE(a.comentario_publico, '')), '') IS NOT NULL
  ORDER BY a.criado_em DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 30), 100));
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_listar_avaliacoes_publicas_artista(UUID, INT) TO authenticated;

-- =====================================================
-- 4) Feed marketplace com reputação do artista
-- =====================================================
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
    CASE
      WHEN p_artista_atual_id IS NOT NULL AND e.artist_id = p_artista_atual_id
      THEN COALESCE(e.feed_mostrar_cache, false)
      ELSE false
    END,
    (e.value IS NOT NULL AND e.value > 0),
    (
      SELECT COUNT(*)::integer
      FROM convite_participacao_evento c
      WHERE c.status IN ('pendente', 'aceito')
        AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
    ),
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
    ),
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
    AND e.event_date >= CURRENT_DATE
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

-- Verificação
SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rpc_app_confirmar_show_e_avaliar',
    'rpc_app_resumo_reputacao_artistas',
    'listar_feed_marketplace'
  )
ORDER BY proname;
