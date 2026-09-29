-- Adiciona valor pago antecipado em events (paid_amount).
-- Sem pagamento informado (NULL ou 0) o app NÃO mostra barra de progresso.
--
-- IMPORTANTE: incluir coluna nova no RETURNS TABLE exige DROP FUNCTION + CREATE
-- (CREATE OR REPLACE não muda o tipo de retorno).
--
-- Rode no SQL Editor do Supabase.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC;

COMMENT ON COLUMN public.events.paid_amount IS
  'Valor já pago/antecipado do cachê. NULL = não informado (sem barra de progresso no app).';

DROP FUNCTION IF EXISTS public.get_events_by_role(uuid);
DROP FUNCTION IF EXISTS public.get_event_by_id_with_role(uuid);

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
  viewer_description TEXT,
  paid_amount NUMERIC
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
    e.viewer_description,
    CASE
      WHEN user_role_var IN ('admin', 'owner') THEN e.paid_amount
      WHEN user_role_var = 'vendedor' AND e.created_by = auth.uid() THEN e.paid_amount
      ELSE NULL
    END AS paid_amount
  FROM events e
  WHERE e.artist_id = p_artist_id
    AND e.ativo IS TRUE
    AND e.feed_tipo IS NULL
  ORDER BY e.event_date DESC, e.start_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.get_event_by_id_with_role(p_event_id UUID)
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
  viewer_description TEXT,
  paid_amount NUMERIC
) AS $$
DECLARE
  user_role_var TEXT;
  event_artist_id UUID;
BEGIN
  SELECT e.artist_id INTO event_artist_id
  FROM events e
  WHERE e.id = p_event_id
    AND e.ativo IS TRUE
    AND e.feed_tipo IS NULL;

  IF event_artist_id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado';
  END IF;

  SELECT am.role INTO user_role_var
  FROM artist_members am
  WHERE am.user_id = auth.uid()
    AND am.artist_id = event_artist_id;

  IF user_role_var IS NULL THEN
    RAISE EXCEPTION 'Usuário não tem acesso a este evento';
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
    e.viewer_description,
    CASE
      WHEN user_role_var IN ('admin', 'owner') THEN e.paid_amount
      WHEN user_role_var = 'vendedor' AND e.created_by = auth.uid() THEN e.paid_amount
      ELSE NULL
    END AS paid_amount
  FROM events e
  WHERE e.id = p_event_id
    AND e.ativo IS TRUE
    AND e.feed_tipo IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_events_by_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_events_by_role(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_by_id_with_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_by_id_with_role(UUID) TO service_role;

COMMENT ON FUNCTION public.get_events_by_role(UUID) IS
  'Eventos ativos; value/paid_amount ocultos para viewer; vendedor só nos que criou.';

COMMIT;

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_events_by_role', 'get_event_by_id_with_role');
