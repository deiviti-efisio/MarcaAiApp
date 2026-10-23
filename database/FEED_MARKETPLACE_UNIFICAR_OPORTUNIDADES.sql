-- Unifica o feed em uma lista só: Oportunidades.
-- Oferta e procura continuam em feed_tipo só para o matching interno
-- (quem convida / quem se candidata). A interface não separa mais as abas.
-- Execute no SQL Editor do Supabase.

COMMENT ON COLUMN public.events.feed_tipo IS
  'Intenção interna do matching: disponivel = estou livre nesta data; demanda = preciso de alguém. A lista do app é única (Oportunidades). NULL = evento normal da agenda.';

UPDATE public.events
SET name = CASE
  WHEN name IN ('Oferta', 'Procurando') THEN 'Oportunidade'
  WHEN name ~* '^(Oferta|Procurando)[[:space:]]*[·\-–]' THEN
    regexp_replace(name, '^(Oferta|Procurando)', 'Oportunidade', 'i')
  ELSE name
END,
    updated_at = NOW()
WHERE feed_tipo IS NOT NULL
  AND (
    name IN ('Oferta', 'Procurando')
    OR name ~* '^(Oferta|Procurando)[[:space:]]*[·\-–]'
  );

NOTIFY pgrst, 'reload schema';

-- Lista oportunidades com data de hoje no fuso do Brasil
-- (CURRENT_DATE no servidor UTC esconde anúncio criado hoje à noite).
CREATE OR REPLACE FUNCTION public.feed_data_hoje_brasil()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

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
    NULL::numeric,
    0,
    0
  FROM events e
  INNER JOIN artists a ON a.id = e.artist_id
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
