-- Lista rápida do Feed → Artistas (só o que o card mostra).
-- Filtros da tela: UF, cidade, nome, função.
-- Clique em Ver → app busca o perfil completo pelo id.
-- Execute no SQL Editor do Supabase.

CREATE INDEX IF NOT EXISTS idx_artists_feed_state_name
  ON public.artists (state, name)
  INCLUDE (profile_url, musical_style, work_roles, city)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_city
  ON public.artists (city text_pattern_ops)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_feed_roles
  ON public.artists USING gin (work_roles)
  WHERE is_available_for_gigs IS TRUE;

DROP FUNCTION IF EXISTS public.listar_artistas_feed(uuid, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.buscar_artistas_proximos(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer);

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uf text;
  v_estado text;
  v_cidade text;
  v_termo text;
  v_funcao jsonb;
BEGIN
  v_uf := NULLIF(upper(trim(p_estado)), '');
  v_estado := CASE v_uf
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
    ELSE NULLIF(trim(p_estado), '')
  END;
  IF v_uf IS NOT NULL AND length(v_uf) <> 2 THEN
    v_uf := NULL;
  END IF;

  v_cidade := NULLIF(trim(p_cidade), '');
  v_termo := NULLIF(trim(p_termo), '');
  IF v_cidade IS NOT NULL AND length(v_cidade) < 2 THEN
    v_cidade := NULL;
  END IF;
  IF v_termo IS NOT NULL AND length(v_termo) < 2 THEN
    v_termo := NULL;
  END IF;
  IF NULLIF(trim(p_funcao), '') IS NULL THEN
    v_funcao := NULL;
  ELSE
    v_funcao := jsonb_build_array(trim(p_funcao));
  END IF;

  RETURN QUERY
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
    AND (v_estado IS NULL OR a.state = v_estado OR a.state = v_uf)
    AND (v_cidade IS NULL OR a.city = v_cidade OR a.city ILIKE v_cidade || '%')
    AND (v_termo IS NULL OR a.name ILIKE v_termo || '%')
    AND (v_funcao IS NULL OR a.work_roles @> v_funcao)
  ORDER BY a.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
