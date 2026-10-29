-- O evento de quem convidou não é a cópia do convidado.
-- Rode no SQL Editor. Tira a trava de edição do criador.

UPDATE public.events e
SET convite_participacao_id = NULL,
    updated_at = NOW()
FROM public.convite_participacao_evento c
WHERE e.convite_participacao_id = c.id
  AND e.id = c.evento_origem_id
  AND e.artist_id = c.artista_que_convidou_id;
