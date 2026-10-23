import { isAbortError } from '../../lib/abortError';
import { supabase } from '../../lib/supabase';

export type FeedTipo = 'disponivel' | 'demanda';
export type FeedFiltro = 'todos' | 'disponivel' | 'demanda' | 'meus';

export interface FeedAnuncio {
  id: string;
  artist_id: string;
  artist_name: string;
  artist_image: string | null;
  musical_style: string | null;
  feed_tipo: FeedTipo;
  event_date: string;
  start_time: string;
  end_time: string;
  city: string | null;
  state_uf: string | null;
  description: string | null;
  evento_nome: string | null;
  feed_funcoes: string[];
  artist_whatsapp: string | null;
  created_at: string;
  is_mine: boolean;
  cache_valor: number | null;
  feed_mostrar_cache: boolean;
  tem_cache: boolean;
  propostas_count: number;
  propostas_avatars: string[];
  ja_proposei: boolean;
  pode_desfazer: boolean;
  artist_media_nota: number | null;
  artist_total_avaliacoes: number;
  artist_shows_realizados: number;
}

export interface FeedProposta {
  evento_id: string;
  convite_id: string;
  artista_id: string;
  artista_nome: string;
  artista_image: string | null;
  funcao: string | null;
  status: string;
  mensagem: string | null;
  criado_em: string;
}

export interface PublicarFeedInput {
  artistaId: string;
  feedTipo: FeedTipo;
  eventDate: string;
  startTime: string;
  endTime: string;
  stateUf?: string | null;
  cacheValor?: number | null;
  city?: string | null;
  observacao?: string | null;
  feedFuncoes: string[];
  whatsapp?: string | null;
  mostrarCache?: boolean;
  nome?: string | null;
}

export interface EditarFeedInput {
  eventoId: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  stateUf?: string | null;
  cacheValor?: number | null;
  city?: string | null;
  observacao?: string | null;
  feedFuncoes: string[];
  whatsapp?: string | null;
  mostrarCache?: boolean;
  nome?: string | null;
}

function isRpcSignatureMissing(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('could not find the function') ||
    m.includes('schema cache') ||
    (m.includes('function') && m.includes('does not exist'))
  );
}

function pickRpcRow<T extends object>(data: T[] | T | null): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

export function isNomeAutomaticoFeed(name: string): boolean {
  const n = name.trim();
  return (
    n === 'Oferta' ||
    n === 'Procurando' ||
    n === 'Oportunidade' ||
    /^(Oferta|Procurando|Oportunidade)\s*[·\-–]\s*/i.test(n)
  );
}

/** Data do anúncio ainda é hoje ou futura (parte YYYY-MM-DD, fuso local do aparelho). */
function isAnuncioFeedAtivo(eventDate: string): boolean {
  const part = String(eventDate ?? '').trim().split('T')[0];
  if (!part || part.length < 10) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return part >= today;
}

function mapAnuncio(row: Record<string, unknown>): FeedAnuncio {
  const tipo: FeedTipo = row.feed_tipo === 'demanda' ? 'demanda' : 'disponivel';
  const isMine = asBoolean(row.is_mine);
  const mostrarCache = asBoolean(row.feed_mostrar_cache);
  const rawCache = row.cache_valor ?? (isMine ? row.meu_cache_valor : null);
  const cacheNumero =
    rawCache == null || rawCache === '' ? null : Number(rawCache);
  const nomeBruto = row.evento_nome != null ? String(row.evento_nome).trim() : '';
  return {
    id: String(row.id),
    artist_id: String(row.artist_id),
    artist_name: String(row.artist_name ?? 'Artista'),
    artist_image: row.artist_image != null ? String(row.artist_image) : null,
    musical_style: row.musical_style != null ? String(row.musical_style) : null,
    feed_tipo: tipo,
    event_date: String(row.event_date ?? ''),
    start_time: String(row.start_time ?? ''),
    end_time: String(row.end_time ?? ''),
    city: row.city != null ? String(row.city) : null,
    state_uf: row.state_uf != null ? String(row.state_uf) : null,
    description: row.description != null ? String(row.description) : null,
    evento_nome:
      nomeBruto && !isNomeAutomaticoFeed(nomeBruto) ? nomeBruto : null,
    feed_funcoes: Array.isArray(row.feed_funcoes)
      ? (row.feed_funcoes as unknown[]).map((item) => String(item)).filter(Boolean)
      : [],
    artist_whatsapp: row.artist_whatsapp != null ? String(row.artist_whatsapp) : null,
    created_at: String(row.created_at ?? ''),
    is_mine: isMine,
    cache_valor: cacheNumero,
    feed_mostrar_cache: mostrarCache,
    tem_cache: asBoolean(row.tem_cache),
    propostas_count: Number(row.propostas_count ?? 0) || 0,
    propostas_avatars:
      isMine && Array.isArray(row.propostas_avatars)
        ? (row.propostas_avatars as unknown[]).map((url) => String(url)).filter(Boolean)
        : [],
    ja_proposei: asBoolean(row.ja_proposei),
    pode_desfazer:
      row.pode_desfazer == null ? asBoolean(row.ja_proposei) : asBoolean(row.pode_desfazer),
    artist_media_nota:
      row.artist_media_nota == null || row.artist_media_nota === ''
        ? null
        : Number.isFinite(Number(row.artist_media_nota))
          ? Number(row.artist_media_nota)
          : null,
    artist_total_avaliacoes: Number(row.artist_total_avaliacoes ?? 0) || 0,
    artist_shows_realizados: Number(row.artist_shows_realizados ?? 0) || 0,
  };
}

export function isErroPropostaDuplicada(error?: string | null): boolean {
  if (!error) return false;
  const texto = error.toLowerCase();
  return (
    texto.includes('já enviou uma proposta') ||
    texto.includes('já iniciou uma negociação') ||
    texto.includes('já existe uma negociação')
  );
}

export async function listarFeedMarketplace(params: {
  filtro: FeedFiltro;
  estadoUf?: string | null;
  cidade?: string | null;
  funcao?: string | null;
  artistaAtualId?: string | null;
  eventoDetalheId?: string | null;
  abortSignal?: AbortSignal;
}): Promise<{ anuncios: FeedAnuncio[]; error: string | null; aborted?: boolean }> {
  try {
    const tipoRpc =
      params.filtro === 'disponivel' || params.filtro === 'demanda'
        ? params.filtro
        : null;
    const payload = {
      p_tipo: tipoRpc,
      p_estado: params.estadoUf?.trim() ? params.estadoUf.trim() : null,
      p_cidade: params.cidade?.trim() ? params.cidade.trim() : null,
      p_artista_atual_id: params.artistaAtualId ?? null,
      p_funcao: params.funcao?.trim() ? params.funcao.trim() : null,
      p_evento_detalhe: params.eventoDetalheId ?? null,
    };
    const runListar = async (args: Record<string, unknown>) => {
      let query = supabase.rpc('listar_feed_marketplace', args);
      if (params.abortSignal) query = query.abortSignal(params.abortSignal);
      return query;
    };
    let { data, error } = await runListar(payload);
    if (error && isRpcSignatureMissing(error.message)) {
      const { p_evento_detalhe: _detalhe, ...semDetalhe } = payload;
      ({ data, error } = await runListar(semDetalhe));
    }
    if (error && isRpcSignatureMissing(error.message)) {
      const { p_evento_detalhe: _detalhe, p_funcao: _funcao, ...basico } = payload;
      ({ data, error } = await runListar(basico));
    }
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { anuncios: [], error: null, aborted: true };
    }
    if (error) return { anuncios: [], error: error.message };
    const rows = (data || []) as Record<string, unknown>[];
    const anuncios = rows.map(mapAnuncio).filter((item) => isAnuncioFeedAtivo(item.event_date));
    return { anuncios, error: null };
  } catch (error) {
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { anuncios: [], error: null, aborted: true };
    }
    return { anuncios: [], error: 'Erro de conexão' };
  }
}

export async function listarPropostasFeedMarketplace(
  artistaAtualId: string,
  abortSignal?: AbortSignal
): Promise<{ propostas: FeedProposta[]; error: string | null; aborted?: boolean }> {
  try {
    let query = supabase.rpc('listar_propostas_feed_marketplace', {
      p_artista_atual_id: artistaAtualId,
    });
    if (abortSignal) query = query.abortSignal(abortSignal);
    const { data, error } = await query;
    if (abortSignal?.aborted || isAbortError(error)) {
      return { propostas: [], error: null, aborted: true };
    }
    if (error) return { propostas: [], error: error.message };
    const rows = (data || []) as Record<string, unknown>[];
    return {
      propostas: rows.map((row) => ({
        evento_id: String(row.evento_id),
        convite_id: String(row.convite_id),
        artista_id: String(row.artista_id),
        artista_nome: String(row.artista_nome ?? 'Artista'),
        artista_image: row.artista_image != null ? String(row.artista_image) : null,
        funcao: row.funcao != null ? String(row.funcao) : null,
        status: String(row.status ?? 'pendente'),
        mensagem: row.mensagem != null ? String(row.mensagem) : null,
        criado_em: String(row.criado_em ?? ''),
      })),
      error: null,
    };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return { propostas: [], error: null, aborted: true };
    }
    return { propostas: [], error: 'Erro de conexão' };
  }
}

export async function publicarFeed(
  input: PublicarFeedInput
): Promise<{ success: boolean; error: string | null; eventoId?: string }> {
  try {
    const payload = {
      p_artista_id: input.artistaId,
      p_feed_tipo: input.feedTipo,
      p_event_date: input.eventDate,
      p_state_uf: input.stateUf?.trim() || null,
      p_cache_valor: input.cacheValor,
      p_city: input.city?.trim() || null,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_observacao: input.observacao?.trim() || null,
      p_feed_funcoes: input.feedFuncoes,
      p_whatsapp: input.whatsapp?.trim() || null,
      p_feed_mostrar_cache: input.mostrarCache === true,
      p_nome: input.nome?.trim() || null,
    };
    let { data, error } = await supabase.rpc('rpc_app_publicar_feed', payload);
    if (error && isRpcSignatureMissing(error.message)) {
      const { p_nome: _omit, ...semNome } = payload;
      ({ data, error } = await supabase.rpc('rpc_app_publicar_feed', semNome));
    }
    if (error) {
      return {
        success: false,
        error: isRpcSignatureMissing(error.message)
          ? 'O banco do feed está desatualizado. Rode database/FEED_MARKETPLACE_PATCH_NOME_EVENTO.sql no SQL Editor.'
          : error.message,
      };
    }
    const row = pickRpcRow<{ success: boolean; error: string | null; evento_id: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao publicar.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível publicar.' };
    return { success: true, error: null, eventoId: row.evento_id ?? undefined };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function editarAnuncioFeed(
  input: EditarFeedInput
): Promise<{ success: boolean; error: string | null }> {
  try {
    const payload = {
      p_evento_id: input.eventoId,
      p_event_date: input.eventDate,
      p_state_uf: input.stateUf?.trim() || null,
      p_cache_valor: input.cacheValor,
      p_city: input.city?.trim() || null,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_observacao: input.observacao?.trim() || null,
      p_feed_funcoes: input.feedFuncoes,
      p_whatsapp: input.whatsapp?.trim() || null,
      p_feed_mostrar_cache: input.mostrarCache === true,
      p_nome: input.nome?.trim() || null,
    };
    let { data, error } = await supabase.rpc('rpc_app_editar_anuncio_feed', payload);
    if (error && isRpcSignatureMissing(error.message)) {
      const { p_nome: _omit, ...semNome } = payload;
      ({ data, error } = await supabase.rpc('rpc_app_editar_anuncio_feed', semNome));
    }
    if (error) {
      return {
        success: false,
        error: isRpcSignatureMissing(error.message)
          ? 'O banco do feed está desatualizado. Rode database/FEED_MARKETPLACE_PATCH_NOME_EVENTO.sql no SQL Editor.'
          : error.message,
      };
    }
    const row = pickRpcRow<{ success: boolean; error: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao editar.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível editar.' };
    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function encerrarAnuncioFeed(
  eventoId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_encerrar_anuncio_feed', {
      p_evento_id: eventoId,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{ success: boolean; error: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao encerrar.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível encerrar.' };
    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function iniciarNegociacaoFeed(input: {
  eventoId: string;
  artistaInteressadoId: string;
  funcaoParticipacao: string;
  mensagem?: string | null;
  nomeEvento?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  city?: string | null;
  stateUf?: string | null;
}): Promise<{
  success: boolean;
  error: string | null;
  conviteId?: string;
  cacheValor?: number | null;
  feedTipo?: FeedTipo | null;
}> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_iniciar_negociacao_feed', {
      p_evento_id: input.eventoId,
      p_artista_interessado_id: input.artistaInteressadoId,
      p_funcao_participacao: input.funcaoParticipacao.trim(),
      p_mensagem: input.mensagem?.trim() || null,
      p_nome_evento: input.nomeEvento?.trim() || null,
      p_event_date: input.eventDate?.trim() || null,
      p_start_time: input.startTime?.trim() || null,
      p_end_time: input.endTime?.trim() || null,
      p_city: input.city?.trim() || null,
      p_state_uf: input.stateUf?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{
      success: boolean;
      error: string | null;
      convite_id: string | null;
      cache_valor: number | null;
      feed_tipo: string | null;
    }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao negociar.' };
    if (!row.success) {
      return { success: false, error: row.error || 'Não foi possível iniciar a negociação.' };
    }
    const conviteId = row.convite_id ?? undefined;
    if (conviteId) {
      void supabase.rpc('rpc_app_notificar_convite_participacao_evento', {
        p_convite_id: conviteId,
      });
    }
    return {
      success: true,
      error: null,
      conviteId,
      cacheValor: row.cache_valor == null ? null : Number(row.cache_valor),
      feedTipo: row.feed_tipo === 'demanda' ? 'demanda' : row.feed_tipo === 'disponivel' ? 'disponivel' : null,
    };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function desfazerPropostaFeed(input: {
  eventoId: string;
  artistaInteressadoId: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_desfazer_proposta_feed', {
      p_evento_id: input.eventoId,
      p_artista_interessado_id: input.artistaInteressadoId,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{ success: boolean; error: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao desfazer a proposta.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível desfazer.' };
    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}
