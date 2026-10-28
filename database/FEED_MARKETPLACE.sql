-- Feed de datas: reutiliza `events` + `convite_participacao_evento`.
-- Não cria tabela nova. Cole TODO este arquivo no SQL Editor do Supabase e rode.
--
-- feed_tipo:
--   'disponivel' = Oferta (oferece artista, banda, músico, serviço, parceria)
--   'demanda'    = Procurando (busca artista, músico, banda, serviço, parceria)
--   NULL         = evento normal da agenda (não entra no feed)
--
-- Foto/vídeo no feed: use database/FEED_SOCIAL.sql (social_posts).
--
-- O cachê fica em events.value e NÃO é devolvido na listagem pública.
-- Só aparece ao iniciar a negociação (convite_participacao_evento.cache_valor).
--
-- Sem BEGIN/COMMIT único: se um trecho falhar, a busca do feed ainda é criada.

CREATE OR REPLACE FUNCTION public.normalize_pt_search(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT translate(
    lower(trim(coalesce(input, ''))),
    'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS feed_tipo TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS feed_funcoes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS feed_mostrar_cache BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.feed_mostrar_cache IS
  'Se true, o cachê (events.value) aparece publicamente no card do feed.';

CREATE INDEX IF NOT EXISTS idx_events_feed_funcoes
  ON public.events USING GIN (feed_funcoes);

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_feed_tipo_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_feed_tipo_check
  CHECK (feed_tipo IS NULL OR feed_tipo IN ('disponivel', 'demanda'));

CREATE INDEX IF NOT EXISTS idx_events_feed_publico
  ON public.events (event_date, feed_tipo)
  WHERE feed_tipo IS NOT NULL AND COALESCE(ativo, true);

COMMENT ON COLUMN public.events.feed_tipo IS
  'Anúncio do feed: disponivel (oferece data) ou demanda (precisa de artista). NULL = agenda normal.';

-- Agenda/financeiro ignoram anúncios do feed
-- DROP obrigatório: CREATE OR REPLACE não troca corpo se o tipo de retorno já existir
-- com a mesma assinatura, mas falha se a assinatura no banco for outra.
DROP FUNCTION IF EXISTS public.get_events_by_role(uuid);

CREATE FUNCTION public.get_events_by_role(p_artist_id UUID)
RETURNS TABLE (
  id UUID,
  artist_id UUID,
  created_by UUID,
  name TEXT,
  description TEXT,
  event_date DATE,
  start_time TIME,
  end_time TIME,
  value NUMERIC,
  city TEXT,
  state_uf TEXT,
  contractor_phone TEXT,
  confirmed BOOLEAN,
  tag TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  user_role TEXT,
  viewer_description TEXT
) AS $$
DECLARE
  user_role_var TEXT;
BEGIN
  SELECT am.role INTO user_role_var
  FROM artist_members am
  WHERE am.user_id = auth.uid()
    AND am.artist_id = p_artist_id;

  IF user_role_var IS NULL THEN
    RAISE EXCEPTION 'Usuário não tem acesso a este artista';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.artist_id,
    e.created_by,
    e.name,
    e.description,
    e.event_date,
    e.start_time,
    e.end_time,
    CASE
      WHEN user_role_var IN ('admin', 'owner') THEN e.value
      WHEN user_role_var = 'vendedor' AND e.created_by = auth.uid() THEN e.value
      ELSE NULL
    END AS value,
    e.city,
    e.state_uf,
    e.contractor_phone,
    e.confirmed,
    e.tag,
    e.created_at::timestamptz,
    e.updated_at::timestamptz,
    user_role_var AS user_role,
    e.viewer_description
  FROM events e
  WHERE e.artist_id = p_artist_id
    AND e.ativo IS TRUE
    AND e.feed_tipo IS NULL
  ORDER BY e.event_date DESC, e.start_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_events_by_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_events_by_role(UUID) TO service_role;

-- Anúncios do feed não disparam "evento atualizado/deletado" da agenda
CREATE OR REPLACE FUNCTION public.notify_event_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  editor_id uuid;
  target_artist_id uuid;
  notification_count integer;
  notif_title text;
  notif_message text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.feed_tipo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  editor_id := COALESCE(NEW.updated_by, NEW.created_by);
  target_artist_id := NEW.artist_id;

  IF editor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.ativo IS NOT NULL AND NEW.ativo = false) THEN
    notif_title := 'Evento deletado';
    notif_message := 'Evento "' || NEW.name || '" foi deletado';
  ELSE
    notif_title := 'Evento atualizado';
    notif_message := 'Evento "' || NEW.name || '" foi atualizado';
  END IF;

  INSERT INTO notifications (
    to_user_id,
    from_user_id,
    artist_id,
    event_id,
    title,
    message,
    type,
    read
  )
  SELECT
    am.user_id,
    editor_id,
    target_artist_id,
    NEW.id,
    notif_title,
    notif_message,
    'event',
    false
  FROM artist_members am
  WHERE am.artist_id = target_artist_id
    AND am.user_id != editor_id
    AND am.user_id IS NOT NULL
    AND editor_id IS NOT NULL;

  GET DIAGNOSTICS notification_count = ROW_COUNT;

  RETURN NEW;
END;
$$;

-- =====================================================
-- Reputação (shows confirmados + avaliados)
-- =====================================================
ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_em TIMESTAMPTZ;

ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS show_confirmado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;

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

-- Data de hoje no fuso de Brasília (evita anúncio "vencido" aparecer por UTC)
CREATE OR REPLACE FUNCTION public.feed_data_hoje_brasil()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

-- Encerra automaticamente anúncios cuja data do show já passou
CREATE OR REPLACE FUNCTION public.encerrar_anuncios_feed_vencidos()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := public.feed_data_hoje_brasil();
  v_count INTEGER := 0;
BEGIN
  UPDATE public.convite_participacao_evento c
  SET
    status = 'cancelado',
    motivo_cancelamento = 'Anúncio encerrado automaticamente: data do show já passou.',
    respondido_em = NOW(),
    atualizado_em = NOW()
  FROM public.events e
  WHERE COALESCE(e.ativo, true) = true
    AND e.feed_tipo IS NOT NULL
    AND e.feed_tipo IN ('disponivel', 'demanda')
    AND e.event_date < v_hoje
    AND (
      c.grupo_disputa_id = e.id
      OR c.evento_origem_id = e.id
    )
    AND c.status = 'pendente';

  UPDATE public.events
  SET
    ativo = false,
    update_ativo = NOW(),
    updated_at = NOW()
  WHERE COALESCE(ativo, true) = true
    AND feed_tipo IS NOT NULL
    AND feed_tipo IN ('disponivel', 'demanda')
    AND event_date < v_hoje;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.encerrar_anuncios_feed_vencidos() TO authenticated;

-- =====================================================
-- Listagem pública (sem cachê; WhatsApp vem de artists.whatsapp)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.encerrar_anuncios_feed_vencidos();

  RETURN QUERY
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
          INNER JOIN artists ar ON ar.id = CASE
            WHEN e.feed_tipo = 'demanda' THEN c.artista_convidado_id
            ELSE c.artista_que_convidou_id
          END
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
          AND (
            (e.feed_tipo = 'demanda' AND c.artista_convidado_id = p_artista_atual_id)
            OR (e.feed_tipo <> 'demanda' AND c.artista_que_convidou_id = p_artista_atual_id)
          )
      )
    ),
    (
      p_artista_atual_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM convite_participacao_evento c
        WHERE c.status = 'pendente'
          AND (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
          AND (
            (e.feed_tipo = 'demanda' AND c.artista_convidado_id = p_artista_atual_id)
            OR (e.feed_tipo <> 'demanda' AND c.artista_que_convidou_id = p_artista_atual_id)
          )
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_feed_marketplace(TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_feed_marketplace(TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO service_role;

-- =====================================================
-- Publicar anúncio
-- =====================================================
DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT);
DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT);
DROP FUNCTION IF EXISTS public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT, BOOLEAN);

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
  p_feed_mostrar_cache BOOLEAN DEFAULT false
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
  ELSE
    SELECT regexp_replace(trim(coalesce(a.whatsapp, '')), '\D', '', 'g')
    INTO v_whatsapp_digits
    FROM public.artists a
    WHERE a.id = p_artista_id;
  END IF;

  IF length(v_whatsapp_digits) <> 11 THEN
    RETURN QUERY SELECT false, 'Informe um WhatsApp válido para contato (DDD + número).', NULL::UUID;
    RETURN;
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

  v_name := CASE
    WHEN p_feed_tipo = 'disponivel' THEN 'Oferta'
    ELSE 'Procurando'
  END
  || ' · '
  || COALESCE(NULLIF(COALESCE(v_city || '/', '') || COALESCE(v_uf, ''), ''), 'Sem local')
  || ' · '
  || to_char(p_event_date, 'DD/MM/YYYY');

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

GRANT EXECUTE ON FUNCTION public.rpc_app_publicar_feed(UUID, TEXT, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT, BOOLEAN) TO authenticated;

-- =====================================================
-- Editar anúncio publicado
-- =====================================================
DROP FUNCTION IF EXISTS public.rpc_app_editar_anuncio_feed(uuid, date, text, numeric, text, time, time, text, text[], text, boolean);

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
  p_feed_mostrar_cache BOOLEAN DEFAULT false
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
  ELSE
    SELECT regexp_replace(trim(coalesce(a.whatsapp, '')), '\D', '', 'g')
    INTO v_whatsapp_digits
    FROM public.artists a
    WHERE a.id = v_event.artist_id;
  END IF;

  IF length(v_whatsapp_digits) <> 11 THEN
    RETURN QUERY SELECT false, 'Informe um WhatsApp válido para contato (DDD + número).';
    RETURN;
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

  v_name := CASE
    WHEN v_event.feed_tipo = 'disponivel' THEN 'Oferta'
    ELSE 'Procurando'
  END
  || ' · '
  || COALESCE(NULLIF(COALESCE(v_city || '/', '') || COALESCE(v_uf, ''), ''), 'Sem local')
  || ' · '
  || to_char(p_event_date, 'DD/MM/YYYY');

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

GRANT EXECUTE ON FUNCTION public.rpc_app_editar_anuncio_feed(UUID, DATE, TEXT, NUMERIC, TEXT, TIME, TIME, TEXT, TEXT[], TEXT, BOOLEAN) TO authenticated;

-- =====================================================
-- Encerrar anúncio
-- =====================================================
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

  UPDATE events
  SET
    ativo = false,
    update_ativo = NOW(),
    updated_by = v_uid,
    updated_at = NOW()
  WHERE id = v_event.id;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_encerrar_anuncio_feed(UUID) TO authenticated;

-- =====================================================
-- Iniciar negociação (revela o cachê no convite)
-- =====================================================
CREATE OR REPLACE FUNCTION public.rpc_app_iniciar_negociacao_feed(
  p_evento_id UUID,
  p_artista_interessado_id UUID,
  p_funcao_participacao TEXT,
  p_mensagem TEXT DEFAULT NULL
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
  v_owner_name TEXT;
  v_booking_name TEXT;
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

  SELECT a.name INTO v_owner_name
  FROM artists a
  WHERE a.id = v_event.artist_id
  LIMIT 1;

  IF v_event.feed_tipo = 'demanda' THEN
    v_origem_id := v_event.id;
    v_convidado_id := p_artista_interessado_id;

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
    -- Disponibilidade: quem se interessou vira organizador (paga o cachê)
    -- e convida o artista que ofereceu a data.
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

    v_booking_name := COALESCE(NULLIF(trim(v_event.name), ''), 'Show')
      || ' · '
      || COALESCE(NULLIF(trim(v_owner_name), ''), 'Artista');

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
    v_event.name,
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

GRANT EXECUTE ON FUNCTION public.rpc_app_iniciar_negociacao_feed(UUID, UUID, TEXT, TEXT) TO authenticated;

-- =====================================================
-- Desfazer proposta pendente (quem se candidatou / demonstrou interesse)
-- =====================================================
ALTER TABLE public.convite_participacao_evento
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

DROP FUNCTION IF EXISTS public.rpc_app_desfazer_proposta_feed(uuid, uuid);

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
  WHERE c.status IN ('pendente', 'aceito')
    AND (c.grupo_disputa_id = v_event.id OR c.evento_origem_id = v_event.id)
    AND c.artista_convidado_id = p_artista_interessado_id
  ORDER BY c.criado_em DESC
  LIMIT 1;

  IF v_convite.id IS NULL THEN
    RETURN QUERY SELECT false, 'Nenhuma proposta sua foi encontrada neste anúncio.';
    RETURN;
  END IF;

  IF v_convite.status = 'aceito' THEN
    RETURN QUERY SELECT false, 'Esta proposta já foi aceita e não pode ser desfeita por aqui.';
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

  IF v_event.feed_tipo = 'disponivel'
    AND v_convite.evento_origem_id IS NOT NULL
    AND v_convite.evento_origem_id IS DISTINCT FROM v_event.id
  THEN
    UPDATE events
    SET
      ativo = false,
      update_ativo = NOW(),
      updated_by = v_uid,
      updated_at = NOW()
    WHERE id = v_convite.evento_origem_id
      AND artist_id = p_artista_interessado_id
      AND feed_tipo IS NULL;
  END IF;

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

-- Ao aceitar a negociação: demanda vira evento real; disponibilidade sai do feed
CREATE OR REPLACE FUNCTION public.trg_feed_apos_aceitar_convite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aceito' AND OLD.status IS DISTINCT FROM 'aceito' THEN
    -- Procurando: o anúncio do publicador vira evento real da agenda.
    UPDATE events
    SET
      feed_tipo = NULL,
      confirmed = true,
      ativo = true,
      updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND feed_tipo = 'demanda'
      AND COALESCE(ativo, true) = true;

    -- Oferecendo: rascunho de quem se interessou entra na agenda.
    UPDATE events
    SET
      ativo = true,
      confirmed = true,
      updated_at = NOW()
    WHERE id = NEW.evento_origem_id
      AND feed_tipo IS NULL
      AND artist_id = NEW.artista_que_convidou_id;

    -- Oferecendo: anúncio original sai do feed.
    UPDATE events
    SET
      ativo = false,
      update_ativo = NOW(),
      feed_tipo = NULL,
      updated_at = NOW()
    WHERE id = NEW.grupo_disputa_id
      AND feed_tipo = 'disponivel'
      AND COALESCE(ativo, true) = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_apos_aceitar_convite ON public.convite_participacao_evento;
CREATE TRIGGER trg_feed_apos_aceitar_convite
  AFTER UPDATE OF status ON public.convite_participacao_evento
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feed_apos_aceitar_convite();

-- Propostas nas minhas publicações (quem iniciou a negociação)
DROP FUNCTION IF EXISTS public.listar_propostas_feed_marketplace(uuid);

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
    ON (
      c.grupo_disputa_id = e.id
      OR c.evento_origem_id = e.id
    )
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

NOTIFY pgrst, 'reload schema';

SELECT
  p.proname AS funcao,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'listar_feed_marketplace',
    'listar_propostas_feed_marketplace',
    'rpc_app_publicar_feed',
    'rpc_app_editar_anuncio_feed',
    'rpc_app_encerrar_anuncio_feed',
    'rpc_app_iniciar_negociacao_feed',
    'rpc_app_desfazer_proposta_feed'
  )
ORDER BY 1;
