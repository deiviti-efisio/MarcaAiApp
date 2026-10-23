import { supabase } from '../../lib/supabase';

export type ConversaResumo = {
  conversationId: string;
  otherArtistId: string;
  otherArtistName: string;
  otherArtistImage: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  subject: string | null;
};

export type MensagemConversa = {
  id: string;
  senderArtistId: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  isDeleted: boolean;
};

function asInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function abrirConversaArtistas(
  meuArtistaId: string,
  outroArtistaId: string,
  assunto?: string | null
): Promise<{ conversationId: string | null; error: string | null }> {
  const payload: Record<string, string> = {
    p_meu_artista_id: meuArtistaId,
    p_outro_artista_id: outroArtistaId,
  };
  const assuntoTrim = (assunto || '').trim();
  if (assuntoTrim) payload.p_assunto = assuntoTrim.slice(0, 500);
  let { data, error } = await supabase.rpc('abrir_conversa_artistas', payload);
  if (error && assuntoTrim) {
    const retry = await supabase.rpc('abrir_conversa_artistas', {
      p_meu_artista_id: meuArtistaId,
      p_outro_artista_id: outroArtistaId,
    });
    data = retry.data;
    error = retry.error;
  }
  if (error) return { conversationId: null, error: error.message };
  const id = data != null ? String(data) : '';
  return { conversationId: id || null, error: id ? null : 'Não foi possível abrir a conversa.' };
}

export async function obterAssuntoConversa(
  conversationId: string,
  meuArtistaId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('obter_assunto_conversa', {
    p_conversation_id: conversationId,
    p_meu_artista_id: meuArtistaId,
  });
  if (error || data == null) return null;
  const text = String(data).trim();
  return text || null;
}

export async function listarConversasArtista(
  meuArtistaId: string
): Promise<{ conversas: ConversaResumo[]; error: string | null }> {
  const { data, error } = await supabase.rpc('listar_conversas_artista', {
    p_meu_artista_id: meuArtistaId,
  });
  if (error) return { conversas: [], error: error.message };
  const rows = Array.isArray(data) ? data : [];
  return {
    conversas: rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        conversationId: String(r.conversation_id),
        otherArtistId: String(r.other_artist_id),
        otherArtistName: String(r.other_artist_name || 'Artista'),
        otherArtistImage: r.other_artist_image != null ? String(r.other_artist_image) : null,
        lastMessage: r.last_message != null ? String(r.last_message) : null,
        lastMessageAt: r.last_message_at != null ? String(r.last_message_at) : null,
        unreadCount: asInt(r.unread_count),
        subject: r.subject != null ? String(r.subject) : null,
      };
    }),
    error: null,
  };
}

export async function listarMensagensConversa(params: {
  conversationId: string;
  meuArtistaId: string;
  before?: string | null;
}): Promise<{ mensagens: MensagemConversa[]; error: string | null }> {
  const { data, error } = await supabase.rpc('listar_mensagens_conversa', {
    p_conversation_id: params.conversationId,
    p_meu_artista_id: params.meuArtistaId,
    p_limit: 80,
    p_before: params.before ?? null,
  });
  if (error) return { mensagens: [], error: error.message };
  const rows = Array.isArray(data) ? data : [];
  const mensagens = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        senderArtistId: String(r.sender_artist_id),
        body: String(r.body || ''),
        createdAt: String(r.created_at || ''),
        isMine: r.is_mine === true || r.is_mine === 't',
        isDeleted: r.is_deleted === true || r.is_deleted === 't',
      };
    })
    .reverse();
  return { mensagens, error: null };
}

export async function enviarMensagemConversa(params: {
  conversationId: string;
  meuArtistaId: string;
  body: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('enviar_mensagem_conversa', {
    p_conversation_id: params.conversationId,
    p_meu_artista_id: params.meuArtistaId,
    p_body: params.body,
  });
  if (error) return { id: null, error: error.message };
  return { id: data != null ? String(data) : null, error: null };
}

export async function excluirMensagemConversa(params: {
  mensagemId: string;
  meuArtistaId: string;
}): Promise<{ success: boolean; error: string | null }> {
  const { error } = await supabase.rpc('excluir_mensagem_conversa', {
    p_mensagem_id: params.mensagemId,
    p_meu_artista_id: params.meuArtistaId,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

export async function marcarConversaLida(
  conversationId: string,
  meuArtistaId: string
): Promise<void> {
  await supabase.rpc('marcar_conversa_lida', {
    p_conversation_id: conversationId,
    p_meu_artista_id: meuArtistaId,
  });
}

export async function contarMensagensNaoLidas(
  meuArtistaId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('contar_mensagens_nao_lidas', {
    p_meu_artista_id: meuArtistaId,
  });
  if (error) return 0;
  return asInt(data);
}

export function subscribeConversasRealtime(params: {
  meuArtistaId: string;
  conversationId?: string;
  onChange: () => void;
}): () => void {
  const channelName = params.conversationId
    ? `conversa:${params.meuArtistaId}:${params.conversationId}`
    : `conversas-badge:${params.meuArtistaId}`;
  const channel = supabase.channel(channelName);

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'artist_conversations' },
    () => params.onChange()
  );

  if (params.conversationId) {
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'artist_messages',
        filter: `conversation_id=eq.${params.conversationId}`,
      },
      () => params.onChange()
    );
  } else {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'artist_messages' },
      () => params.onChange()
    );
  }

  void channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
