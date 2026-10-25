import { supabase } from '../../lib/supabase';

export type CicloStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'cancellation_requested'
  | 'cancelled_by_mutual_agreement'
  | 'cancelled'
  | 'under_review'
  | 'completed';

export type CancelamentoSolicitacao = {
  id: string;
  solicitado_por_artista_id: string;
  motivo: string;
  descricao: string | null;
  pagamento_info: string | null;
  status: 'pending' | 'accepted' | 'contested';
  respondido_por_artista_id: string | null;
  resposta_nota: string | null;
  criado_em: string;
  respondido_em: string | null;
};

export type Contratacao = {
  id: string;
  ciclo_status: CicloStatus;
  status_convite: string;
  artista_anfitriao_id: string;
  artista_convidado_id: string;
  nome_evento: string;
  data_evento: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  cidade: string | null;
  estado_uf: string | null;
  cache_valor: number | null;
  funcao_participacao: string | null;
  condicoes_pagamento: string | null;
  show_confirmado: boolean;
  show_confirmado_anfitriao: boolean;
  show_confirmado_convidado: boolean;
  respondido_em: string | null;
  cancelamentos: CancelamentoSolicitacao[];
};

export type EstatisticasPerfilArtista = {
  shows_realizados: number;
  contratantes_atendidos: number;
  media_nota: number | null;
  total_avaliacoes: number;
  parcerias_aceitas: number;
  parcerias_concluidas: number;
  taxa_conclusao: number | null;
};

export type AvaliacaoPendente = {
  convite_id: string;
  nome_evento: string;
  data_evento: string;
  outro_artista_id: string;
  outro_artista_nome: string;
};

function asCiclo(value: unknown): CicloStatus {
  const v = String(value || '');
  if (
    v === 'pending_confirmation' ||
    v === 'confirmed' ||
    v === 'cancellation_requested' ||
    v === 'cancelled_by_mutual_agreement' ||
    v === 'cancelled' ||
    v === 'under_review' ||
    v === 'completed'
  ) {
    return v;
  }
  return 'confirmed';
}

export function rotuloCicloStatus(status: CicloStatus): string {
  switch (status) {
    case 'pending_confirmation':
      return 'Aguardando confirmação';
    case 'confirmed':
      return 'Confirmada';
    case 'cancellation_requested':
      return 'Cancelamento solicitado';
    case 'cancelled_by_mutual_agreement':
      return 'Cancelada em acordo';
    case 'cancelled':
      return 'Cancelada';
    case 'under_review':
      return 'Em análise';
    case 'completed':
      return 'Show concluído';
    default:
      return status;
  }
}

export async function obterEstatisticasPerfilArtista(
  artistId: string
): Promise<{ stats: EstatisticasPerfilArtista | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_estatisticas_perfil_artista', {
      p_artista_id: artistId,
    });
    if (error) return { stats: null, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        stats: {
          shows_realizados: 0,
          contratantes_atendidos: 0,
          media_nota: null,
          total_avaliacoes: 0,
          parcerias_aceitas: 0,
          parcerias_concluidas: 0,
          taxa_conclusao: null,
        },
        error: null,
      };
    }
    const r = row as Record<string, unknown>;
    const media = r.media_nota == null || r.media_nota === '' ? null : Number(r.media_nota);
    const taxa = r.taxa_conclusao == null || r.taxa_conclusao === '' ? null : Number(r.taxa_conclusao);
    return {
      stats: {
        shows_realizados: Number(r.shows_realizados ?? 0) || 0,
        contratantes_atendidos: Number(r.contratantes_atendidos ?? 0) || 0,
        media_nota: media != null && Number.isFinite(media) ? media : null,
        total_avaliacoes: Number(r.total_avaliacoes ?? 0) || 0,
        parcerias_aceitas: Number(r.parcerias_aceitas ?? 0) || 0,
        parcerias_concluidas: Number(r.parcerias_concluidas ?? 0) || 0,
        taxa_conclusao: taxa != null && Number.isFinite(taxa) ? taxa : null,
      },
      error: null,
    };
  } catch {
    return { stats: null, error: 'Erro de conexão' };
  }
}

export async function obterContratacao(
  conviteId: string
): Promise<{ contratacao: Contratacao | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_obter_contratacao', {
      p_convite_id: conviteId,
    });
    if (error) return { contratacao: null, error: error.message };
    const payload = data as Record<string, unknown> | null;
    if (!payload || payload.success === false) {
      return { contratacao: null, error: String(payload?.error || 'Não foi possível abrir a contratação.') };
    }
    const c = payload.contratacao as Record<string, unknown>;
    const cancels = Array.isArray(c.cancelamentos) ? c.cancelamentos : [];
    return {
      contratacao: {
        id: String(c.id),
        ciclo_status: asCiclo(c.ciclo_status),
        status_convite: String(c.status_convite || ''),
        artista_anfitriao_id: String(c.artista_anfitriao_id),
        artista_convidado_id: String(c.artista_convidado_id),
        nome_evento: String(c.nome_evento || 'Show'),
        data_evento: String(c.data_evento || ''),
        hora_inicio: c.hora_inicio != null ? String(c.hora_inicio) : null,
        hora_fim: c.hora_fim != null ? String(c.hora_fim) : null,
        cidade: c.cidade != null ? String(c.cidade) : null,
        estado_uf: c.estado_uf != null ? String(c.estado_uf) : null,
        cache_valor: c.cache_valor == null ? null : Number(c.cache_valor),
        funcao_participacao: c.funcao_participacao != null ? String(c.funcao_participacao) : null,
        condicoes_pagamento: c.condicoes_pagamento != null ? String(c.condicoes_pagamento) : null,
        show_confirmado: c.show_confirmado === true,
        show_confirmado_anfitriao: c.show_confirmado_anfitriao === true,
        show_confirmado_convidado: c.show_confirmado_convidado === true,
        respondido_em: c.respondido_em != null ? String(c.respondido_em) : null,
        cancelamentos: cancels.map((item) => {
          const s = item as Record<string, unknown>;
          return {
            id: String(s.id),
            solicitado_por_artista_id: String(s.solicitado_por_artista_id),
            motivo: String(s.motivo || ''),
            descricao: s.descricao != null ? String(s.descricao) : null,
            pagamento_info: s.pagamento_info != null ? String(s.pagamento_info) : null,
            status: s.status === 'accepted' || s.status === 'contested' ? s.status : 'pending',
            respondido_por_artista_id:
              s.respondido_por_artista_id != null ? String(s.respondido_por_artista_id) : null,
            resposta_nota: s.resposta_nota != null ? String(s.resposta_nota) : null,
            criado_em: String(s.criado_em || ''),
            respondido_em: s.respondido_em != null ? String(s.respondido_em) : null,
          } as CancelamentoSolicitacao;
        }),
      },
      error: null,
    };
  } catch {
    return { contratacao: null, error: 'Erro de conexão' };
  }
}

export async function solicitarCancelamentoContratacao(input: {
  conviteId: string;
  motivo: string;
  descricao?: string;
  pagamentoInfo?: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_solicitar_cancelamento_contratacao', {
      p_convite_id: input.conviteId,
      p_motivo: input.motivo.trim(),
      p_descricao: input.descricao?.trim() || null,
      p_pagamento_info: input.pagamentoInfo?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const r = (row || {}) as { success?: boolean; error?: string | null };
    return { success: r.success === true, error: r.error || null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function responderCancelamentoContratacao(input: {
  solicitacaoId: string;
  aceitar: boolean;
  nota?: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_responder_cancelamento_contratacao', {
      p_solicitacao_id: input.solicitacaoId,
      p_aceitar: input.aceitar,
      p_nota: input.nota?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const r = (row || {}) as { success?: boolean; error?: string | null };
    return { success: r.success === true, error: r.error || null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function confirmarRealizacaoContratacao(
  conviteId: string
): Promise<{ success: boolean; error: string | null; cicloStatus?: string }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_confirmar_realizacao_contratacao', {
      p_convite_id: conviteId,
    });
    if (error) return { success: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const r = (row || {}) as { success?: boolean; error?: string | null; ciclo_status?: string };
    return { success: r.success === true, error: r.error || null, cicloStatus: r.ciclo_status };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function avaliarParceiroContratacao(input: {
  conviteId: string;
  notaGeral: number;
  notaA?: number | null;
  notaB?: number | null;
  notaC?: number | null;
  notaD?: number | null;
  comentario?: string | null;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_avaliar_parceiro_contratacao', {
      p_convite_id: input.conviteId,
      p_nota_geral: input.notaGeral,
      p_nota_a: input.notaA ?? null,
      p_nota_b: input.notaB ?? null,
      p_nota_c: input.notaC ?? null,
      p_nota_d: input.notaD ?? null,
      p_comentario_publico: input.comentario?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const r = (row || {}) as { success?: boolean; error?: string | null };
    return { success: r.success === true, error: r.error || null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function listarAvaliacoesPendentes(
  artistId: string
): Promise<{ itens: AvaliacaoPendente[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_avaliacoes_pendentes_artista', {
      p_artista_id: artistId,
    });
    if (error) return { itens: [], error: error.message };
    const rows = (data || []) as Record<string, unknown>[];
    return {
      itens: rows.map((row) => ({
        convite_id: String(row.convite_id),
        nome_evento: String(row.nome_evento || 'Show'),
        data_evento: String(row.data_evento || ''),
        outro_artista_id: String(row.outro_artista_id),
        outro_artista_nome: String(row.outro_artista_nome || 'Artista'),
      })),
      error: null,
    };
  } catch {
    return { itens: [], error: 'Erro de conexão' };
  }
}
