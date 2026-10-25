-- Filtro de artistas por gênero (estilo), função no palco e formato de show (como se apresenta).
-- Execute no SQL Editor do Supabase.

DROP FUNCTION IF EXISTS public.listar_todos_artistas(integer, integer);
DROP FUNCTION IF EXISTS public.listar_todos_artistas(text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.listar_todos_artistas(text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.listar_todos_artistas(text, text, text, text, text, text, integer, integer);

CREATE FUNCTION public.listar_todos_artistas(
  p_estado text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_genero text DEFAULT NULL,
  p_termo text DEFAULT NULL,
  p_funcao text DEFAULT NULL,
  p_formato text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  image_url text,
  musical_style text,
  work_roles jsonb,
  show_formats jsonb,
  city text,
  state text,
  tem_show_hoje boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
SET plan_cache_mode = force_custom_plan
AS $$
  SELECT
    a.id,
    a.name,
    a.profile_url,
    a.musical_style,
    a.work_roles,
    a.show_formats,
    a.city,
    a.state,
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.artist_id = a.id
        AND COALESCE(e.confirmed, false) = true
        AND COALESCE(e.ativo, true) = true
        AND e.feed_tipo IS NULL
        AND e.event_date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    )
  FROM public.artists a
  WHERE (
      NULLIF(trim(p_estado), '') IS NULL
      OR a.state = CASE upper(trim(p_estado))
        WHEN 'AC' THEN 'Acre'
        WHEN 'AL' THEN 'Alagoas'
        WHEN 'AP' THEN 'Amapá'
        WHEN 'AM' THEN 'Amazonas'
        WHEN 'BA' THEN 'Bahia'
        WHEN 'CE' THEN 'Ceará'
        WHEN 'DF' THEN 'Distrito Federal'
        WHEN 'ES' THEN 'Espírito Santo'
        WHEN 'GO' THEN 'Goiás'
        WHEN 'MA' THEN 'Maranhão'
        WHEN 'MT' THEN 'Mato Grosso'
        WHEN 'MS' THEN 'Mato Grosso do Sul'
        WHEN 'MG' THEN 'Minas Gerais'
        WHEN 'PA' THEN 'Pará'
        WHEN 'PB' THEN 'Paraíba'
        WHEN 'PR' THEN 'Paraná'
        WHEN 'PE' THEN 'Pernambuco'
        WHEN 'PI' THEN 'Piauí'
        WHEN 'RJ' THEN 'Rio de Janeiro'
        WHEN 'RN' THEN 'Rio Grande do Norte'
        WHEN 'RS' THEN 'Rio Grande do Sul'
        WHEN 'RO' THEN 'Rondônia'
        WHEN 'RR' THEN 'Roraima'
        WHEN 'SC' THEN 'Santa Catarina'
        WHEN 'SP' THEN 'São Paulo'
        WHEN 'SE' THEN 'Sergipe'
        WHEN 'TO' THEN 'Tocantins'
        ELSE trim(p_estado)
      END
    )
    AND (
      length(trim(coalesce(p_cidade, ''))) < 2
      OR a.city ILIKE trim(p_cidade) || '%'
    )
    AND (
      NULLIF(trim(p_genero), '') IS NULL
      OR a.musical_style ILIKE '%' || trim(p_genero) || '%'
    )
    AND (
      length(trim(coalesce(p_termo, ''))) < 2
      OR a.name ILIKE trim(p_termo) || '%'
    )
    AND (
      length(trim(coalesce(p_funcao, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.work_roles, '[]'::jsonb)) AS w(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_funcao)) > 0
      )
    )
    AND (
      length(trim(coalesce(p_formato, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.show_formats, '[]'::jsonb)) AS f(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_formato)) > 0
      )
    )
  ORDER BY a.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.listar_todos_artistas(text, text, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_todos_artistas(text, text, text, text, text, text, integer, integer) TO service_role;

DROP FUNCTION IF EXISTS public.listar_artistas_favoritos(uuid, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.listar_artistas_favoritos(uuid, text, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.listar_artistas_favoritos(uuid, text, text, text, text, text, text, integer, integer);

CREATE FUNCTION public.listar_artistas_favoritos(
  p_artista_atual_id uuid,
  p_cidade text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_termo text DEFAULT NULL,
  p_funcao text DEFAULT NULL,
  p_genero text DEFAULT NULL,
  p_formato text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  image_url text,
  musical_style text,
  work_roles jsonb,
  show_formats jsonb,
  city text,
  state text,
  tem_show_hoje boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.id,
    a.name,
    a.profile_url,
    a.musical_style,
    a.work_roles,
    a.show_formats,
    a.city,
    a.state,
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.artist_id = a.id
        AND COALESCE(e.confirmed, false) = true
        AND COALESCE(e.ativo, true) = true
        AND e.feed_tipo IS NULL
        AND e.event_date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    )
  FROM public.artist_favorites f
  JOIN public.artists a ON a.id = f.artist_id
  WHERE f.user_id = auth.uid()
    AND (p_artista_atual_id IS NULL OR a.id <> p_artista_atual_id)
    AND (
      NULLIF(trim(p_estado), '') IS NULL
      OR a.state = trim(p_estado)
      OR a.state = CASE upper(trim(p_estado))
        WHEN 'AC' THEN 'Acre'
        WHEN 'AL' THEN 'Alagoas'
        WHEN 'AP' THEN 'Amapá'
        WHEN 'AM' THEN 'Amazonas'
        WHEN 'BA' THEN 'Bahia'
        WHEN 'CE' THEN 'Ceará'
        WHEN 'DF' THEN 'Distrito Federal'
        WHEN 'ES' THEN 'Espírito Santo'
        WHEN 'GO' THEN 'Goiás'
        WHEN 'MA' THEN 'Maranhão'
        WHEN 'MT' THEN 'Mato Grosso'
        WHEN 'MS' THEN 'Mato Grosso do Sul'
        WHEN 'MG' THEN 'Minas Gerais'
        WHEN 'PA' THEN 'Pará'
        WHEN 'PB' THEN 'Paraíba'
        WHEN 'PR' THEN 'Paraná'
        WHEN 'PE' THEN 'Pernambuco'
        WHEN 'PI' THEN 'Piauí'
        WHEN 'RJ' THEN 'Rio de Janeiro'
        WHEN 'RN' THEN 'Rio Grande do Norte'
        WHEN 'RS' THEN 'Rio Grande do Sul'
        WHEN 'RO' THEN 'Rondônia'
        WHEN 'RR' THEN 'Roraima'
        WHEN 'SC' THEN 'Santa Catarina'
        WHEN 'SP' THEN 'São Paulo'
        WHEN 'SE' THEN 'Sergipe'
        WHEN 'TO' THEN 'Tocantins'
        ELSE trim(p_estado)
      END
    )
    AND (
      length(trim(coalesce(p_cidade, ''))) < 2
      OR a.city ILIKE trim(p_cidade) || '%'
    )
    AND (
      length(trim(coalesce(p_termo, ''))) < 2
      OR a.name ILIKE trim(p_termo) || '%'
    )
    AND (
      length(trim(coalesce(p_funcao, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.work_roles, '[]'::jsonb)) AS w(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_funcao)) > 0
      )
    )
    AND (
      NULLIF(trim(p_genero), '') IS NULL
      OR a.musical_style ILIKE '%' || trim(p_genero) || '%'
    )
    AND (
      length(trim(coalesce(p_formato, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.show_formats, '[]'::jsonb)) AS f(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_formato)) > 0
      )
    )
  ORDER BY f.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.listar_artistas_favoritos(uuid, text, text, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_artistas_favoritos(uuid, text, text, text, text, text, text, integer, integer) TO service_role;

DROP FUNCTION IF EXISTS public.buscar_artistas_para_convite(text, uuid);
DROP FUNCTION IF EXISTS public.buscar_artistas_para_convite(text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.buscar_artistas_para_convite(text, uuid, text, text, text, text, text);

CREATE FUNCTION public.buscar_artistas_para_convite(
  p_termo text,
  p_excluir_artista_id uuid,
  p_cidade text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_funcao text DEFAULT NULL,
  p_genero text DEFAULT NULL,
  p_formato text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  profile_url text,
  image_url text,
  musical_style text,
  work_roles jsonb,
  show_formats jsonb,
  whatsapp text,
  city text,
  state text,
  show_whatsapp boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.id,
    a.name,
    a.profile_url,
    COALESCE(
      NULLIF(trim(COALESCE(a.profile_url, '')), ''),
      lu.member_profile_url
    ) AS image_url,
    a.musical_style,
    COALESCE(a.work_roles, '[]'::jsonb),
    COALESCE(a.show_formats, '[]'::jsonb),
    CASE
      WHEN COALESCE(a.show_whatsapp, false) IS TRUE THEN NULLIF(trim(COALESCE(a.whatsapp, '')), '')
      ELSE NULL
    END,
    NULLIF(trim(COALESCE(a.city, '')), ''),
    NULLIF(trim(COALESCE(a.state, '')), ''),
    COALESCE(a.show_whatsapp, false)
  FROM artists a
  LEFT JOIN LATERAL (
    SELECT u.profile_url AS member_profile_url
    FROM artist_members am
    INNER JOIN users u ON u.id = am.user_id
    WHERE am.artist_id = a.id
      AND u.profile_url IS NOT NULL
      AND trim(COALESCE(u.profile_url, '')) <> ''
    ORDER BY
      CASE am.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'editor' THEN 3
        ELSE 4
      END,
      am.created_at ASC NULLS LAST
    LIMIT 1
  ) lu ON true
  WHERE (p_excluir_artista_id IS NULL OR a.id <> p_excluir_artista_id)
    AND a.is_available_for_gigs IS TRUE
    AND length(trim(coalesce(p_termo, ''))) >= 2
    AND length(public.normalize_pt_search(p_termo)) >= 2
    AND strpos(public.normalize_pt_search(a.name), public.normalize_pt_search(p_termo)) > 0
    AND (
      length(trim(coalesce(p_cidade, ''))) < 2
      OR (
        coalesce(trim(a.city), '') <> ''
        AND strpos(public.normalize_pt_search(a.city), public.normalize_pt_search(p_cidade)) > 0
      )
    )
    AND (
      length(trim(coalesce(p_estado, ''))) < 2
      OR (
        coalesce(trim(a.state), '') <> ''
        AND (
          strpos(public.normalize_pt_search(a.state), public.normalize_pt_search(p_estado)) > 0
          OR upper(trim(a.state)) = upper(trim(p_estado))
        )
      )
    )
    AND (
      length(trim(coalesce(p_funcao, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.work_roles, '[]'::jsonb)) AS w(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_funcao)) > 0
      )
    )
    AND (
      NULLIF(trim(p_genero), '') IS NULL
      OR strpos(public.normalize_pt_search(a.musical_style), public.normalize_pt_search(p_genero)) > 0
    )
    AND (
      length(trim(coalesce(p_formato, ''))) < 2
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(a.show_formats, '[]'::jsonb)) AS f(v)
        WHERE length(trim(v)) > 0
          AND strpos(public.normalize_pt_search(v), public.normalize_pt_search(p_formato)) > 0
      )
    )
  ORDER BY a.name;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_artistas_para_convite(text, uuid, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
