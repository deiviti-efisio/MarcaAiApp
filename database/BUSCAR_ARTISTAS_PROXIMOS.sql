-- Lista leve do Feed → Artistas, filtrada pelo estado (nome completo em artists.state).
-- Se o app mandar UF (RS), a função traduz para "Rio Grande do Sul".
-- Execute no SQL Editor do Supabase.

CREATE INDEX IF NOT EXISTS idx_artists_available_state
  ON public.artists (state)
  WHERE is_available_for_gigs IS TRUE;

CREATE INDEX IF NOT EXISTS idx_artists_available_name
  ON public.artists (name)
  WHERE is_available_for_gigs IS TRUE;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH ufs(uf, nome) AS (
    VALUES
      ('AC', 'Acre'),
      ('AL', 'Alagoas'),
      ('AP', 'Amapá'),
      ('AM', 'Amazonas'),
      ('BA', 'Bahia'),
      ('CE', 'Ceará'),
      ('DF', 'Distrito Federal'),
      ('ES', 'Espírito Santo'),
      ('GO', 'Goiás'),
      ('MA', 'Maranhão'),
      ('MT', 'Mato Grosso'),
      ('MS', 'Mato Grosso do Sul'),
      ('MG', 'Minas Gerais'),
      ('PA', 'Pará'),
      ('PB', 'Paraíba'),
      ('PR', 'Paraná'),
      ('PE', 'Pernambuco'),
      ('PI', 'Piauí'),
      ('RJ', 'Rio de Janeiro'),
      ('RN', 'Rio Grande do Norte'),
      ('RS', 'Rio Grande do Sul'),
      ('RO', 'Rondônia'),
      ('RR', 'Roraima'),
      ('SC', 'Santa Catarina'),
      ('SP', 'São Paulo'),
      ('SE', 'Sergipe'),
      ('TO', 'Tocantins')
  ),
  filtro AS (
    SELECT
      NULLIF(trim(p_cidade), '') AS cidade,
      COALESCE(
        (SELECT u.nome FROM ufs u WHERE u.uf = upper(trim(p_estado))),
        NULLIF(trim(p_estado), '')
      ) AS estado_nome,
      (
        SELECT u.uf FROM ufs u
        WHERE u.uf = upper(trim(p_estado))
           OR lower(u.nome) = lower(trim(p_estado))
        LIMIT 1
      ) AS estado_uf
  )
  SELECT
    a.id,
    a.name,
    NULLIF(trim(COALESCE(a.profile_url, '')), '') AS image_url,
    NULLIF(trim(COALESCE(a.musical_style, '')), '') AS musical_style,
    COALESCE(a.work_roles, '[]'::jsonb) AS work_roles,
    NULLIF(trim(COALESCE(a.city, '')), '') AS city,
    NULLIF(trim(COALESCE(a.state, '')), '') AS state
  FROM public.artists a
  CROSS JOIN filtro f
  WHERE (p_artista_atual_id IS NULL OR a.id <> p_artista_atual_id)
    AND a.is_available_for_gigs IS TRUE
    AND (
      f.estado_nome IS NULL
      OR a.state IN (f.estado_nome, f.estado_uf)
      OR a.state ILIKE f.estado_nome
    )
    AND (
      f.cidade IS NULL
      OR a.city ILIKE '%' || f.cidade || '%'
    )
    AND (
      length(trim(coalesce(p_termo, ''))) < 2
      OR a.name ILIKE '%' || trim(p_termo) || '%'
    )
    AND (
      length(trim(coalesce(p_funcao, ''))) < 2
      OR a.work_roles::text ILIKE '%' || trim(p_funcao) || '%'
    )
  ORDER BY a.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_artistas_proximos(uuid, text, text, text, text, integer, integer) TO service_role;

-- Nome novo para o Feed não cair na RPC antiga (ranking pesado).
DROP FUNCTION IF EXISTS public.listar_artistas_feed(uuid, text, text, text, text, integer, integer);
CREATE FUNCTION public.listar_artistas_feed(
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
AS $$
  SELECT * FROM public.buscar_artistas_proximos(
    p_artista_atual_id, p_cidade, p_estado, p_termo, p_funcao, p_limit, p_offset
  );
$$;

GRANT EXECUTE ON FUNCTION public.listar_artistas_feed(uuid, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_artistas_feed(uuid, text, text, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
