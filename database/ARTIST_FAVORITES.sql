-- Favoritos de artistas (por usuário logado).
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.artist_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_artist_favorites_user
  ON public.artist_favorites (user_id, created_at DESC);

ALTER TABLE public.artist_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.artist_favorites FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.artist_favorites TO authenticated;

DROP POLICY IF EXISTS artist_favorites_own ON public.artist_favorites;
CREATE POLICY artist_favorites_own
  ON public.artist_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP FUNCTION IF EXISTS public.listar_artistas_favoritos(uuid, text, text, text, text, integer, integer);

CREATE FUNCTION public.listar_artistas_favoritos(
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
  SELECT
    a.id,
    a.name,
    a.profile_url,
    a.musical_style,
    a.work_roles,
    a.city,
    a.state
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
      NULLIF(trim(p_funcao), '') IS NULL
      OR a.work_roles @> jsonb_build_array(trim(p_funcao))
    )
  ORDER BY f.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 40))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.listar_artistas_favoritos(uuid, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_artistas_favoritos(uuid, text, text, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
