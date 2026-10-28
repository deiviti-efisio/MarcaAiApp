-- Encerra oportunidades vencidas dentro do banco, sem chamada do app.
-- A lista já esconde data passada (event_date >= feed_data_hoje_brasil).
-- Este job só desativa o anúncio e cancela convites pendentes.
--
-- No Supabase: Database → Extensions → habilite pg_cron.
-- Depois rode este arquivo no SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'encerrar-anuncios-feed-vencidos'
  ) THEN
    PERFORM cron.unschedule('encerrar-anuncios-feed-vencidos');
  END IF;
END;
$$;

-- 00:10 em Brasília (03:10 UTC)
SELECT cron.schedule(
  'encerrar-anuncios-feed-vencidos',
  '10 3 * * *',
  $$SELECT public.encerrar_anuncios_feed_vencidos();$$
);

-- A lista de candidaturas só consulta. O encerramento fica no job acima.
CREATE OR REPLACE FUNCTION public.listar_propostas_feed_marketplace(
  p_artista_atual_id UUID
)
RETURNS TABLE (
  evento_id UUID,
  convite_id UUID,
  artista_id UUID,
  artista_nome TEXT,
  artista_image TEXT,
  funcao TEXT,
  status TEXT,
  mensagem TEXT,
  criado_em TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    c.id,
    a.id,
    a.name,
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    NULLIF(trim(COALESCE(c.funcao_participacao, '')), ''),
    c.status,
    NULLIF(trim(COALESCE(c.mensagem, '')), ''),
    c.criado_em
  FROM events e
  INNER JOIN convite_participacao_evento c
    ON (c.grupo_disputa_id = e.id OR c.evento_origem_id = e.id)
  INNER JOIN artists a ON a.id = c.artista_convidado_id
  WHERE e.feed_tipo IS NOT NULL
    AND COALESCE(e.ativo, true) = true
    AND e.event_date >= public.feed_data_hoje_brasil()
    AND c.status IN ('pendente', 'aceito')
    AND p_artista_atual_id IS NOT NULL
    AND e.artist_id = p_artista_atual_id
  ORDER BY c.criado_em DESC;
$$;

GRANT EXECUTE ON FUNCTION public.listar_propostas_feed_marketplace(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_propostas_feed_marketplace(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
