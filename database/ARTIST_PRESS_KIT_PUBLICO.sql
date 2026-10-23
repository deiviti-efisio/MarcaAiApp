-- Press kit visível no perfil público (qualquer usuário autenticado pode ler).
-- Execute no SQL Editor do Supabase.

DROP POLICY IF EXISTS "artist_press_kit_select_members" ON public.artist_press_kit_items;
DROP POLICY IF EXISTS "artist_press_kit_select_authenticated" ON public.artist_press_kit_items;

CREATE POLICY "artist_press_kit_select_authenticated"
  ON public.artist_press_kit_items
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP FUNCTION IF EXISTS public.listar_press_kit_publico_artista(uuid);

CREATE FUNCTION public.listar_press_kit_publico_artista(p_artist_id uuid)
RETURNS TABLE (
  id uuid,
  artist_id uuid,
  item_type text,
  title text,
  url text,
  storage_path text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    i.id,
    i.artist_id,
    i.item_type,
    i.title,
    i.url,
    i.storage_path,
    i.sort_order,
    i.created_at,
    i.updated_at
  FROM public.artist_press_kit_items i
  WHERE i.artist_id = p_artist_id
  ORDER BY i.sort_order ASC, i.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.listar_press_kit_publico_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_press_kit_publico_artista(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.listar_press_kit_publico_artista(uuid) TO service_role;
