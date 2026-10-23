-- Lista rápida do Feed → Artistas (só o que o card mostra).
-- Filtros da tela Artistas: estado, cidade, gênero e nome.
-- Sem filtro → todos os artistas.
-- Clique em Ver → app busca o perfil completo pelo id.
-- Execute no SQL Editor do Supabase.

CREATE INDEX IF NOT EXISTS idx_artists_feed_state_name
  ON public.artists (state, name)
  INCLUDE (profile_url, musical_style, city)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_name
  ON public.artists (name)
  INCLUDE (profile_url, musical_style, city, state)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_city
  ON public.artists (city text_pattern_ops)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_roles
  ON public.artists USING gin (work_roles)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_id_available
  ON public.artists (id)
  WHERE is_available_for_gigs IS TRUE;

DROP FUNCTION IF EXISTS public.listar_artistas_feed(uuid, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.buscar_artistas_proximos(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.estado_do_artista(uuid);

-- PK lookup sem RLS (a tabela artists com user_has_access trava o app).
CREATE FUNCTION public.estado_do_artista(p_artista_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT a.state
  FROM public.artists a
  WHERE a.id = p_artista_id
  LIMIT 1;
$$;

-- SQL (não plpgsql) para o planner usar índice em state/name.
-- Compara só o nome completo do estado — sem OR com UF.
CREATE FUNCTION public.buscar_artistas_proximos(
  p_artista_atual_id uuid,
  p_cidade text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_termo text DEFAULT NULL,
  p_funcao text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  image_url text,
  musical_style text,
  work_roles jsonb,
  city text,
  state text
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
    a.city,
    a.state
  FROM public.artists a
  WHERE a.is_available_for_gigs IS TRUE
    AND (p_artista_atual_id IS NULL OR a.id <> p_artista_atual_id)
    AND (
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
      length(trim(coalesce(p_termo, ''))) < 2
      OR a.name ILIKE trim(p_termo) || '%'
    )
    AND (
      NULLIF(trim(p_funcao), '') IS NULL
      OR a.work_roles @> jsonb_build_array(trim(p_funcao))
    )
  ORDER BY a.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

CREATE INDEX IF NOT EXISTS idx_artists_feed_style
  ON public.artists (musical_style);

DROP FUNCTION IF EXISTS public.listar_todos_artistas(integer, integer);
DROP FUNCTION IF EXISTS public.listar_todos_artistas(text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.listar_todos_artistas(text, text, text, text, integer, integer);

-- Feed Artistas: estado, cidade, gênero e nome. Sem filtro → todos.
CREATE FUNCTION public.listar_todos_artistas(
  p_estado text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_genero text DEFAULT NULL,
  p_termo text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  image_url text,
  musical_style text,
  work_roles jsonb,
  city text,
  state text
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
    a.city,
    a.state
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
      OR a.musical_style ILIKE trim(p_genero)
      OR a.musical_style ILIKE trim(p_genero) || '%'
    )
    AND (
      length(trim(coalesce(p_termo, ''))) < 2
      OR a.name ILIKE trim(p_termo) || '%'
    )
  ORDER BY a.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.estado_do_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_do_artista(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_todos_artistas(text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_todos_artistas(text, text, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
