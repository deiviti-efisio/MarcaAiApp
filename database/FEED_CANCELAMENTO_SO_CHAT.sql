-- O cancelamento da participação manda uma mensagem só no chat:
-- a do app, com o evento e o motivo.
-- Rode no SQL Editor. Não reenvie o texto simples antigo.

CREATE OR REPLACE FUNCTION public._mensagem_interessado_cancelou(
  p_artista_remetente UUID,
  p_artista_destinatario UUID,
  p_texto TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;
