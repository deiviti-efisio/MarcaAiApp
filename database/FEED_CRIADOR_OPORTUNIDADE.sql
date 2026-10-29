-- Quem criou a oportunidade (já gravado em events.created_by na publicação).
-- Só administrador ou dono do artista que publicou recebe nome, avatar e data.
-- Execute no SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION public.rpc_app_criador_oportunidade(p_evento_id uuid)
RETURNS TABLE (
  user_id uuid,
  nome text,
  avatar text,
  criado_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_artist uuid;
  v_created_by uuid;
  v_created_at timestamptz;
BEGIN
  IF v_uid IS NULL OR p_evento_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.artist_id, e.created_by, e.created_at
  INTO v_artist, v_created_by, v_created_at
  FROM public.events e
  WHERE e.id = p_evento_id
    AND e.feed_tipo IN ('disponivel', 'demanda');

  IF v_artist IS NULL OR v_created_by IS NULL THEN
    RETURN;
  END IF;

  IF NOT public._is_member_of_artist(v_uid, v_artist, ARRAY['admin', 'owner']) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(NULLIF(trim(u.name), ''), 'Usuário'),
    NULLIF(trim(COALESCE(u.profile_url, '')), ''),
    v_created_at
  FROM public.users u
  WHERE u.id = v_created_by;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_app_criador_oportunidade(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
