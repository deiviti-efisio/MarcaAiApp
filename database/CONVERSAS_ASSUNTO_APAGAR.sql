-- Assunto da conversa (show) + apagar mensagem no estilo Instagram.
-- Cole no SQL Editor do Supabase. Pode rodar mais de uma vez.

ALTER TABLE public.artist_conversations
  ADD COLUMN IF NOT EXISTS subject text;

ALTER TABLE public.artist_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP FUNCTION IF EXISTS public.abrir_conversa_artistas(uuid, uuid);
DROP FUNCTION IF EXISTS public.abrir_conversa_artistas(uuid, uuid, text);
CREATE FUNCTION public.abrir_conversa_artistas(
  p_meu_artista_id uuid,
  p_outro_artista_id uuid,
  p_assunto text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_low uuid;
  v_high uuid;
  v_id uuid;
  v_assunto text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_meu_artista_id IS NULL OR p_outro_artista_id IS NULL THEN
    RAISE EXCEPTION 'Artistas inválidos';
  END IF;
  IF p_meu_artista_id = p_outro_artista_id THEN
    RAISE EXCEPTION 'Não é possível conversar com o próprio perfil';
  END IF;
  IF NOT public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = p_outro_artista_id) THEN
    RAISE EXCEPTION 'Artista não encontrado';
  END IF;

  v_low := LEAST(p_meu_artista_id, p_outro_artista_id);
  v_high := GREATEST(p_meu_artista_id, p_outro_artista_id);
  v_assunto := left(trim(COALESCE(p_assunto, '')), 500);

  SELECT c.id INTO v_id
  FROM public.artist_conversations c
  WHERE c.artist_low = v_low AND c.artist_high = v_high;

  IF v_id IS NULL THEN
    INSERT INTO public.artist_conversations (artist_low, artist_high, subject)
    VALUES (v_low, v_high, NULLIF(v_assunto, ''))
    RETURNING id INTO v_id;
  ELSIF v_assunto <> '' THEN
    UPDATE public.artist_conversations
    SET subject = v_assunto
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.obter_assunto_conversa(uuid, uuid);
CREATE FUNCTION public.obter_assunto_conversa(
  p_conversation_id uuid,
  p_meu_artista_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.subject
  FROM public.artist_conversations c
  WHERE c.id = p_conversation_id
    AND public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL)
    AND (c.artist_low = p_meu_artista_id OR c.artist_high = p_meu_artista_id);
$$;

DROP FUNCTION IF EXISTS public.listar_conversas_artista(uuid);
CREATE FUNCTION public.listar_conversas_artista(p_meu_artista_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  other_artist_id uuid,
  other_artist_name text,
  other_artist_image text,
  last_message text,
  last_message_at timestamptz,
  unread_count integer,
  subject text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.id,
    CASE WHEN c.artist_low = p_meu_artista_id THEN c.artist_high ELSE c.artist_low END,
    COALESCE(a.name, 'Artista'),
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    c.last_message,
    c.last_message_at,
    (
      SELECT COUNT(*)::integer
      FROM public.artist_messages m
      WHERE m.conversation_id = c.id
        AND m.sender_artist_id <> p_meu_artista_id
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
          CASE WHEN c.artist_low = p_meu_artista_id THEN c.last_read_low ELSE c.last_read_high END,
          'epoch'::timestamptz
        )
    ),
    c.subject
  FROM public.artist_conversations c
  JOIN public.artists a
    ON a.id = CASE WHEN c.artist_low = p_meu_artista_id THEN c.artist_high ELSE c.artist_low END
  WHERE public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL)
    AND (c.artist_low = p_meu_artista_id OR c.artist_high = p_meu_artista_id)
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.listar_mensagens_conversa(uuid, uuid, int, timestamptz);
CREATE FUNCTION public.listar_mensagens_conversa(
  p_conversation_id uuid,
  p_meu_artista_id uuid,
  p_limit int DEFAULT 80,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  sender_artist_id uuid,
  body text,
  created_at timestamptz,
  is_mine boolean,
  is_deleted boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    m.id,
    m.sender_artist_id,
    CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END,
    m.created_at,
    (m.sender_artist_id = p_meu_artista_id),
    (m.deleted_at IS NOT NULL)
  FROM public.artist_messages m
  JOIN public.artist_conversations c ON c.id = m.conversation_id
  WHERE m.conversation_id = p_conversation_id
    AND public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL)
    AND (c.artist_low = p_meu_artista_id OR c.artist_high = p_meu_artista_id)
    AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 80), 200));
$$;

DROP FUNCTION IF EXISTS public.excluir_mensagem_conversa(uuid, uuid);
CREATE FUNCTION public.excluir_mensagem_conversa(
  p_mensagem_id uuid,
  p_meu_artista_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_last text;
  v_last_at timestamptz;
BEGIN
  IF NOT public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  UPDATE public.artist_messages m
  SET
    deleted_at = now(),
    body = ''
  FROM public.artist_conversations c
  WHERE m.id = p_mensagem_id
    AND m.sender_artist_id = p_meu_artista_id
    AND m.deleted_at IS NULL
    AND c.id = m.conversation_id
    AND (c.artist_low = p_meu_artista_id OR c.artist_high = p_meu_artista_id)
  RETURNING m.conversation_id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível apagar esta mensagem';
  END IF;

  SELECT m.body, m.created_at
    INTO v_last, v_last_at
  FROM public.artist_messages m
  WHERE m.conversation_id = v_conversation_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1;

  UPDATE public.artist_conversations
  SET
    last_message = COALESCE(NULLIF(v_last, ''), 'Mensagem apagada'),
    last_message_at = COALESCE(v_last_at, last_message_at, now())
  WHERE id = v_conversation_id;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.contar_mensagens_nao_lidas(uuid);
CREATE FUNCTION public.contar_mensagens_nao_lidas(p_meu_artista_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM public.artist_conversations c
  WHERE public._is_member_of_artist(auth.uid(), p_meu_artista_id, NULL)
    AND (c.artist_low = p_meu_artista_id OR c.artist_high = p_meu_artista_id)
    AND EXISTS (
      SELECT 1
      FROM public.artist_messages m
      WHERE m.conversation_id = c.id
        AND m.sender_artist_id <> p_meu_artista_id
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
          CASE WHEN c.artist_low = p_meu_artista_id THEN c.last_read_low ELSE c.last_read_high END,
          'epoch'::timestamptz
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.abrir_conversa_artistas(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_assunto_conversa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_conversas_artista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_mensagens_conversa(uuid, uuid, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_mensagem_conversa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contar_mensagens_nao_lidas(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
