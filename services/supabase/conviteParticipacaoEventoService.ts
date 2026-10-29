import { isAbortError } from '../../lib/abortError';
import { estadoNomeCompletoParaBusca } from '../../lib/brazilGeo';
import {
  artistJsonArrayMatches,
  normalizeArtistSearch,
  normalizeShowFormats,
} from '../../constants/artistProfileLists';
import { supabase } from '../../lib/supabase';

export type StatusConviteParticipacao = 'pendente' | 'aceito' | 'recusado' | 'cancelado';

export interface ConviteParticipacaoEventoRow {
  id: string;
  evento_origem_id: string;
  artista_que_convidou_id: string;
  artista_convidado_id: string;
  status: StatusConviteParticipacao;
  mensagem: string | null;
  motivo_cancelamento?: string | null;
  nome_evento: string;
  data_evento: string;
  hora_inicio: string;
  hora_fim: string;
  cache_valor: number | null;
  cidade: string | null;
  estado_uf?: string | null;
  telefone_contratante: string | null;
  descricao: string | null;
  funcao_participacao: string | null;
  grupo_disputa_id?: string | null;
  evento_criado_convidado_id: string | null;
  usuario_que_enviou_id: string;
  respondido_em: string | null;
  criado_em: string;
  atualizado_em: string;
  show_confirmado?: boolean;
  show_confirmado_em?: string | null;
}

export interface AvaliacaoParticipacaoEventoRow {
  convite_participacao_evento_id: string;
  artista_avaliado_id: string;
  nota_geral: number;
  nota_pontualidade: number | null;
  nota_profissionalismo: number | null;
  nota_qualidade_tecnica: number | null;
  nota_comunicacao: number | null;
  comentario_publico: string | null;
  observacao_privada: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ArtistaBuscaConvite {
  id: string;
  name: string;
  profile_url: string | null;
  /** URL para exibir na busca: foto do artista ou, se vazia, foto de um membro (ex.: admin). */
  image_url?: string | null;
  cover_url?: string | null;
  bio?: string | null;
  musical_style?: string | null;
  work_roles?: unknown;
  show_formats?: unknown;
  whatsapp?: string | null;
  city?: string | null;
  state?: string | null;
  /** Só exibir WhatsApp no app quando true (privacidade). */
  show_whatsapp?: boolean;
  same_city?: boolean;
  same_state?: boolean;
  tem_show_hoje?: boolean;
}

export interface ResumoAvaliacaoArtistaConvite {
  artista_avaliado_id: string;
  media_nota_geral: number | null;
  total_avaliacoes: number;
  comentario_publico_recente: string | null;
}

export interface AvaliacaoPublicaArtistaConvite {
  nota_geral: number;
  comentario_publico: string;
  criado_em: string;
  artista_avaliador_id: string;
  artista_avaliador_nome: string;
  artista_avaliador_imagem: string | null;
  nome_evento: string | null;
}

export interface BuscarArtistasParaConviteFiltros {
  cidade?: string;
  estado?: string;
  funcao?: string;
  genero?: string;
  formato?: string;
}

export async function buscarArtistasParaConvite(
  termo: string,
  excluirArtistaId: string,
  filtros?: BuscarArtistasParaConviteFiltros
): Promise<{ artists: ArtistaBuscaConvite[]; error: string | null }> {
  try {
    const payload = {
      p_termo: termo?.trim() || '',
      p_excluir_artista_id: excluirArtistaId,
      p_cidade: filtros?.cidade?.trim() ? filtros.cidade.trim() : null,
      p_estado: filtros?.estado?.trim() ? filtros.estado.trim() : null,
      p_funcao: filtros?.funcao?.trim() ? filtros.funcao.trim() : null,
      p_genero: filtros?.genero?.trim() ? filtros.genero.trim() : null,
      p_formato: filtros?.formato?.trim() ? filtros.formato.trim() : null,
    };
    let { data, error } = await supabase.rpc('buscar_artistas_para_convite', payload);
    if (error && isMissingRpc(error)) {
      const retry = await supabase.rpc('buscar_artistas_para_convite', {
        p_termo: payload.p_termo,
        p_excluir_artista_id: payload.p_excluir_artista_id,
        p_cidade: payload.p_cidade,
        p_estado: payload.p_estado,
        p_funcao: payload.p_funcao,
      });
      data = retry.data;
      error = retry.error;
      if (!error && data) {
        const artists = ((data || []) as Record<string, unknown>[])
          .map((row) => mapArtistaBuscaRow(row))
          .filter((item) => matchesArtistSearchFilters(item, filtros));
        return { artists, error: null };
      }
    }
    if (error) return { artists: [], error: error.message };
    const raw = (data || []) as Record<string, unknown>[];
    const artists: ArtistaBuscaConvite[] = raw.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      profile_url: row.profile_url != null ? String(row.profile_url) : null,
      image_url: row.image_url != null ? String(row.image_url) : undefined,
      musical_style: row.musical_style != null ? String(row.musical_style) : undefined,
      work_roles: row.work_roles,
      show_formats: row.show_formats,
      whatsapp: row.whatsapp != null ? String(row.whatsapp) : null,
      city: row.city != null ? String(row.city) : null,
      state: row.state != null ? String(row.state) : null,
      show_whatsapp: row.show_whatsapp === true,
    }));
    return { artists, error: null };
  } catch {
    return { artists: [], error: 'Erro de conexão' };
  }
}

function mapArtistaBuscaRow(row: Record<string, unknown>): ArtistaBuscaConvite {
  const image =
    row.image_url != null && String(row.image_url).trim()
      ? String(row.image_url)
      : row.profile_url != null && String(row.profile_url).trim()
        ? String(row.profile_url)
        : null;
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    profile_url: image,
    image_url: image,
    musical_style: row.musical_style != null ? String(row.musical_style) : undefined,
    work_roles: row.work_roles,
    show_formats: row.show_formats,
    city: row.city != null ? String(row.city) : null,
    state: row.state != null ? String(row.state) : null,
    tem_show_hoje:
      row.tem_show_hoje === true ||
      row.tem_show_hoje === 't' ||
      row.tem_show_hoje === 'true' ||
      row.tem_show_hoje === 1,
  };
}

export const ARTISTAS_BUSCA_PAGE_SIZE = 20;

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  const msg = String(e.message || '').toLowerCase();
  return (
    e.code === 'PGRST202' ||
    e.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('schema cache') ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

function matchesArtistSearchFilters(
  item: ArtistaBuscaConvite,
  filtros?: { funcao?: string | null; genero?: string | null; formato?: string | null }
): boolean {
  const genero = (filtros?.genero || '').trim();
  const funcao = (filtros?.funcao || '').trim();
  const formato = (filtros?.formato || '').trim();
  if (
    genero.length >= 2 &&
    !normalizeArtistSearch(String(item.musical_style || '')).includes(normalizeArtistSearch(genero))
  ) {
    return false;
  }
  if (funcao.length >= 2 && !artistJsonArrayMatches(item.work_roles, funcao)) return false;
  if (
    formato.length >= 2 &&
    !artistJsonArrayMatches(item.show_formats, formato) &&
    !artistJsonArrayMatches(normalizeShowFormats(item.show_formats), formato)
  ) {
    return false;
  }
  return true;
}

function abortedResult(signal?: AbortSignal, error?: unknown) {
  return Boolean(signal?.aborted || isAbortError(error));
}

/** Artistas do Feed: estado, cidade, gênero, função, formato e nome. Sem filtro → todos. */
export async function listarTodosArtistas(params: {
  artistaAtualId?: string | null;
  estado?: string | null;
  cidade?: string | null;
  genero?: string | null;
  funcao?: string | null;
  formato?: string | null;
  termo?: string | null;
  limit?: number;
  offset?: number;
  abortSignal?: AbortSignal;
}): Promise<{ artists: ArtistaBuscaConvite[]; hasMore: boolean; error: string | null; aborted?: boolean }> {
  const limit = Math.min(Math.max(params.limit ?? ARTISTAS_BUSCA_PAGE_SIZE, 1), 40);
  const offset = Math.max(params.offset ?? 0, 0);
  const estado = (params.estado || '').trim();
  const cidade = (params.cidade || '').trim();
  const genero = (params.genero || '').trim();
  const funcao = (params.funcao || '').trim();
  const formato = (params.formato || '').trim();
  const termo = (params.termo || '').trim();
  const excluirId = params.artistaAtualId || null;
  const signal = params.abortSignal;

  const finish = (data: unknown[] | null) => {
    const rows = ((data || []) as Record<string, unknown>[]).map(mapArtistaBuscaRow);
    const artists = excluirId ? rows.filter((item) => item.id !== excluirId) : rows;
    return { artists, hasMore: rows.length >= limit, error: null as string | null };
  };

  try {
    let todos = supabase.rpc('listar_todos_artistas', {
      p_estado: estado.length > 0 ? estado : null,
      p_cidade: cidade.length >= 2 ? cidade : null,
      p_genero: genero.length > 0 ? genero : null,
      p_termo: termo.length >= 2 ? termo : null,
      p_funcao: funcao.length >= 2 ? funcao : null,
      p_formato: formato.length >= 2 ? formato : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (signal) todos = todos.abortSignal(signal);
    const first = await todos;
    if (abortedResult(signal, first.error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    if (!first.error) return finish((first.data || []) as unknown[]);

    if (isMissingRpc(first.error)) {
      let legacy = supabase.rpc('listar_todos_artistas', {
        p_estado: estado.length > 0 ? estado : null,
        p_cidade: cidade.length >= 2 ? cidade : null,
        p_genero: genero.length > 0 ? genero : null,
        p_termo: termo.length >= 2 ? termo : null,
        p_limit: limit,
        p_offset: offset,
      });
      if (signal) legacy = legacy.abortSignal(signal);
      const legacyRes = await legacy;
      if (abortedResult(signal, legacyRes.error)) {
        return { artists: [], hasMore: false, error: null, aborted: true };
      }
      if (!legacyRes.error) {
        const mapped = finish((legacyRes.data || []) as unknown[]);
        const filtered = mapped.artists.filter((item) =>
          matchesArtistSearchFilters(item, { funcao, genero, formato })
        );
        return { artists: filtered, hasMore: false, error: null };
      }

      let prox = supabase.rpc('buscar_artistas_proximos', {
        p_artista_atual_id: null,
        p_cidade: cidade.length >= 2 ? cidade : null,
        p_estado: estado.length > 0 ? estado : null,
        p_termo: termo.length >= 2 ? termo : null,
        p_funcao: funcao.length >= 2 ? funcao : null,
        p_limit: limit,
        p_offset: offset,
      });
      if (signal) prox = prox.abortSignal(signal);
      const second = await prox;
      if (abortedResult(signal, second.error)) {
        return { artists: [], hasMore: false, error: null, aborted: true };
      }
      if (!second.error) {
        const mapped = finish((second.data || []) as unknown[]);
        const filtered = mapped.artists.filter((item) =>
          matchesArtistSearchFilters(item, { funcao, genero, formato })
        );
        return { artists: filtered, hasMore: false, error: null };
      }
      if (!isMissingRpc(second.error)) {
        return { artists: [], hasMore: false, error: second.error.message };
      }
    } else {
      return { artists: [], hasMore: false, error: first.error.message };
    }

    const estadoNome = estadoNomeCompletoParaBusca(estado);
    let table = supabase
      .from('artists')
      .select('id, name, profile_url, musical_style, work_roles, show_formats, city, state')
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);
    if (excluirId) table = table.neq('id', excluirId);
    if (estadoNome) table = table.eq('state', estadoNome);
    if (cidade.length >= 2) table = table.ilike('city', `${cidade}%`);
    if (genero.length > 0) table = table.ilike('musical_style', `%${genero}%`);
    if (termo.length >= 2) table = table.ilike('name', `${termo}%`);
    if (signal) table = table.abortSignal(signal);
    const third = await table;
    if (abortedResult(signal, third.error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    if (third.error) return { artists: [], hasMore: false, error: third.error.message };
    const mapped = finish((third.data || []) as unknown[]);
    const filtered = mapped.artists.filter((item) =>
      matchesArtistSearchFilters(item, { funcao, genero, formato })
    );
    return { artists: filtered, hasMore: false, error: null };
  } catch (error) {
    if (abortedResult(signal, error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    return { artists: [], hasMore: false, error: 'Erro de conexão' };
  }
}

export async function listarArtistasProximos(params: {
  artistaAtualId?: string | null;
  cidade?: string | null;
  estado?: string | null;
  termo?: string | null;
  funcao?: string | null;
  limit?: number;
  offset?: number;
  abortSignal?: AbortSignal;
}): Promise<{ artists: ArtistaBuscaConvite[]; hasMore: boolean; error: string | null; aborted?: boolean }> {
  const limit = Math.min(Math.max(params.limit ?? ARTISTAS_BUSCA_PAGE_SIZE, 1), 40);
  const offset = Math.max(params.offset ?? 0, 0);
  const termo = (params.termo || '').trim();
  const cidade = (params.cidade || '').trim();
  const funcao = (params.funcao || '').trim();
  const estado = (params.estado || '').trim();

  try {
    let query = supabase.rpc('buscar_artistas_proximos', {
      p_artista_atual_id: params.artistaAtualId ?? null,
      p_cidade: cidade.length >= 2 ? cidade : null,
      p_estado: estado.length > 0 ? estado : null,
      p_termo: termo.length >= 2 ? termo : null,
      p_funcao: funcao.length >= 2 ? funcao : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (params.abortSignal) query = query.abortSignal(params.abortSignal);
    const { data, error } = await query;
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    if (error) return { artists: [], hasMore: false, error: error.message };
    const artists = ((data || []) as Record<string, unknown>[]).map(mapArtistaBuscaRow);
    return { artists, hasMore: artists.length >= limit, error: null };
  } catch (error) {
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    return { artists: [], hasMore: false, error: 'Erro de conexão' };
  }
}

/** Artistas que já aceitaram convite de participação deste organizador (última colaboração primeiro). */
export type ParceiroRecenteParticipacao = ArtistaBuscaConvite & {
  ultima_funcao: string | null;
  ultima_colaboracao_em: string;
  /** Cadastro do artista convidado; false indica que o perfil não está aberto para busca de shows. */
  is_available_for_gigs: boolean;
  /** Data do show do convite aceito (coluna data_evento do convite). */
  participacao_data_evento: string | null;
  /** Cachê combinado no convite aceito. */
  ultimo_cache_valor: number | null;
};

/** Mesmo perfil de parceiro recente, com contagem de participações aceitas (organizador → convidado). */
export type ParceiroFrequenteParticipacao = ParceiroRecenteParticipacao & {
  totalParticipacoesAceitas: number;
  /** Funções distintas já registradas em convites aceitos (ordenadas). */
  funcoesParticipacao: string[];
};

export type HistoricoParticipacaoParceiroItem = {
  conviteId: string;
  nomeEvento: string;
  dataEvento: string;
  funcaoParticipacao: string | null;
};

export async function listarParceirosRecentesParticipacao(
  artistaQueConvidaId: string,
  limite: number = 15
): Promise<{ partners: ParceiroRecenteParticipacao[]; error: string | null }> {
  try {
    const capped = Math.min(50, Math.max(1, Math.floor(limite)));
    const { data, error } = await supabase.rpc('listar_parceiros_recentes_participacao', {
      p_artista_que_convida_id: artistaQueConvidaId,
      p_limite: capped,
    });
    if (error) return { partners: [], error: error.message };
    const raw = (data || []) as Record<string, unknown>[];
    const partners: ParceiroRecenteParticipacao[] = raw.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      profile_url: row.profile_url != null ? String(row.profile_url) : null,
      image_url: row.image_url != null ? String(row.image_url) : undefined,
      musical_style: row.musical_style != null ? String(row.musical_style) : undefined,
      work_roles: row.work_roles,
      show_formats: row.show_formats,
      whatsapp: row.whatsapp != null ? String(row.whatsapp) : null,
      city: row.city != null ? String(row.city) : null,
      state: row.state != null ? String(row.state) : null,
      show_whatsapp: row.show_whatsapp === true,
      is_available_for_gigs: row.is_available_for_gigs === true,
      ultima_funcao: row.ultima_funcao != null && String(row.ultima_funcao).trim() !== '' ? String(row.ultima_funcao) : null,
      ultima_colaboracao_em:
        row.ultima_colaboracao_em != null ? String(row.ultima_colaboracao_em) : new Date(0).toISOString(),
      participacao_data_evento:
        row.participacao_data_evento != null && String(row.participacao_data_evento).trim() !== ''
          ? String(row.participacao_data_evento).slice(0, 10)
          : null,
      ultimo_cache_valor: (() => {
        const v = row.ultimo_cache_valor;
        if (v == null || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      })(),
    }));
    return { partners, error: null };
  } catch {
    return { partners: [], error: 'Erro de conexão' };
  }
}

/** Artistas com quem este perfil mais fechou participação aceita (ordenado por quantidade). */
export async function listarParceirosFrequentesParticipacao(
  artistaQueConvidaId: string,
  limite: number = 30
): Promise<{ partners: ParceiroFrequenteParticipacao[]; error: string | null }> {
  try {
    const capped = Math.min(50, Math.max(1, Math.floor(limite)));
    const { data, error } = await supabase.rpc('listar_parceiros_frequentes_participacao', {
      p_artista_que_convida_id: artistaQueConvidaId,
      p_limite: capped,
    });
    if (error) return { partners: [], error: error.message };
    const raw = (data || []) as Record<string, unknown>[];
    const partners: ParceiroFrequenteParticipacao[] = raw.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      profile_url: row.profile_url != null ? String(row.profile_url) : null,
      image_url: row.image_url != null ? String(row.image_url) : undefined,
      musical_style: row.musical_style != null ? String(row.musical_style) : undefined,
      work_roles: row.work_roles,
      show_formats: row.show_formats,
      whatsapp: row.whatsapp != null ? String(row.whatsapp) : null,
      city: row.city != null ? String(row.city) : null,
      state: row.state != null ? String(row.state) : null,
      show_whatsapp: row.show_whatsapp === true,
      is_available_for_gigs: row.is_available_for_gigs === true,
      ultima_funcao: row.ultima_funcao != null && String(row.ultima_funcao).trim() !== '' ? String(row.ultima_funcao) : null,
      ultima_colaboracao_em:
        row.ultima_colaboracao_em != null ? String(row.ultima_colaboracao_em) : new Date(0).toISOString(),
      participacao_data_evento:
        row.participacao_data_evento != null && String(row.participacao_data_evento).trim() !== ''
          ? String(row.participacao_data_evento).slice(0, 10)
          : null,
      ultimo_cache_valor: (() => {
        const v = row.ultimo_cache_valor;
        if (v == null || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      })(),
      totalParticipacoesAceitas: (() => {
        const v = row.total_participacoes_aceitas;
        if (v == null || v === '') return 0;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      })(),
      funcoesParticipacao: (() => {
        const v = row.funcoes_participacao;
        if (v == null) return [];
        if (Array.isArray(v)) {
          return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
        }
        return [];
      })(),
    }));
    return { partners, error: null };
  } catch {
    return { partners: [], error: 'Erro de conexão' };
  }
}

/** Histórico de eventos aceitos entre organizador e parceiro convidado. */
export async function listarHistoricoParticipacaoParceiro(
  artistaQueConvidaId: string,
  artistaConvidadoId: string,
  limite: number = 20
): Promise<{ eventos: HistoricoParticipacaoParceiroItem[]; error: string | null }> {
  try {
    const capped = Math.min(50, Math.max(1, Math.floor(limite)));
    const { data, error } = await supabase
      .from('convite_participacao_evento')
      .select('id, nome_evento, data_evento, funcao_participacao, respondido_em, atualizado_em, criado_em')
      .eq('artista_que_convidou_id', artistaQueConvidaId)
      .eq('artista_convidado_id', artistaConvidadoId)
      .eq('status', 'aceito')
      .order('data_evento', { ascending: false })
      .order('respondido_em', { ascending: false })
      .order('atualizado_em', { ascending: false })
      .order('criado_em', { ascending: false })
      .limit(capped);
    if (error) return { eventos: [], error: error.message };
    const eventos: HistoricoParticipacaoParceiroItem[] = ((data as Record<string, unknown>[]) || []).map((row) => ({
      conviteId: String(row.id),
      nomeEvento: String(row.nome_evento ?? 'Evento'),
      dataEvento: String(row.data_evento ?? '').slice(0, 10),
      funcaoParticipacao:
        row.funcao_participacao != null && String(row.funcao_participacao).trim() !== ''
          ? String(row.funcao_participacao).trim()
          : null,
    }));
    return { eventos, error: null };
  } catch {
    return { eventos: [], error: 'Erro de conexão' };
  }
}

export async function listarConvitesDoEvento(
  eventoOrigemId: string
): Promise<{ convites: ConviteParticipacaoEventoRow[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('convite_participacao_evento')
      .select('*')
      .eq('evento_origem_id', eventoOrigemId)
      .order('criado_em', { ascending: false });
    if (error) return { convites: [], error: error.message };
    return { convites: (data as ConviteParticipacaoEventoRow[]) || [], error: null };
  } catch {
    return { convites: [], error: 'Erro de conexão' };
  }
}

export async function listarConvitesPendentesRecebidos(
  artistaConvidadoId: string
): Promise<{ convites: ConviteParticipacaoEventoRow[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('convite_participacao_evento')
      .select('*')
      .eq('artista_convidado_id', artistaConvidadoId)
      .eq('status', 'pendente')
      .order('criado_em', { ascending: false });
    if (error) return { convites: [], error: error.message };
    return { convites: (data as ConviteParticipacaoEventoRow[]) || [], error: null };
  } catch {
    return { convites: [], error: 'Erro de conexão' };
  }
}

/** Cópia na agenda de quem foi convidado. O evento original de quem convidou continua editável. */
export function eventoEhCopiaDoConvidado(
  event: {
    id?: string | null;
    artist_id?: string | null;
    convite_participacao_id?: string | null;
  },
  convite: Pick<
    ConviteParticipacaoEventoRow,
    'evento_origem_id' | 'artista_que_convidou_id'
  > | null,
): boolean {
  if (!event.convite_participacao_id) return false;
  if (
    convite &&
    event.id &&
    event.artist_id &&
    event.id === convite.evento_origem_id &&
    event.artist_id === convite.artista_que_convidou_id
  ) {
    return false;
  }
  return true;
}

export async function obterConvitePorId(
  id: string
): Promise<{ convite: ConviteParticipacaoEventoRow | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('convite_participacao_evento')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return { convite: null, error: error.message };
    return { convite: data as ConviteParticipacaoEventoRow | null, error: null };
  } catch {
    return { convite: null, error: 'Erro de conexão' };
  }
}

export interface EnviarConviteParticipacaoInput {
  eventoOrigemId: string;
  artistaQueConvidaId: string;
  artistaConvidadoId: string;
  usuarioQueEnviaId: string;
  funcaoParticipacao: string;
  mensagem?: string | null;
  nomeEvento: string;
  dataEvento: string;
  horaInicio: string;
  horaFim: string;
  cacheValor?: number | null;
  cidade?: string | null;
  telefoneContratante?: string | null;
  descricao?: string | null;
  /** Mesmo UUID em vários envios = mesma rodada de leilão. */
  grupoDisputaId?: string | null;
}

export interface EnviarConvitesLeilaoInput {
  eventoOrigemId: string;
  artistaQueConvidaId: string;
  usuarioQueEnviaId: string;
  artistaConvidadoIds: string[];
  funcaoParticipacao: string;
  mensagem?: string | null;
  nomeEvento: string;
  dataEvento: string;
  horaInicio: string;
  horaFim: string;
  cacheValor: number;
  cidade?: string | null;
  telefoneContratante?: string | null;
  descricao?: string | null;
}

export type ResultadoLinhaLeilao = {
  artistaConvidadoId: string;
  success: boolean;
  error: string | null;
  conviteId?: string;
};

type RpcSimpleResult = {
  success: boolean;
  error: string | null;
};

function pickRpcRow<T extends object>(data: T[] | T | null): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

export async function enviarConviteParticipacao(
  input: EnviarConviteParticipacaoInput
): Promise<{ success: boolean; error: string | null; conviteId?: string }> {
  try {
    if (input.artistaQueConvidaId === input.artistaConvidadoId) {
      return { success: false, error: 'Não é possível convidar o mesmo artista.' };
    }
    if (input.cacheValor == null || Number(input.cacheValor) <= 0) {
      return { success: false, error: 'Informe o cachê do convite (obrigatório).' };
    }
    if (!input.funcaoParticipacao?.trim()) {
      return { success: false, error: 'Informe a função do participante (obrigatório).' };
    }
    const { data, error } = await supabase.rpc('rpc_app_enviar_convite_participacao_evento', {
      p_evento_origem_id: input.eventoOrigemId,
      p_artista_convidado_id: input.artistaConvidadoId,
      p_cache_valor: Number(input.cacheValor),
      p_telefone_contratante: input.telefoneContratante?.trim() || null,
      p_funcao_participacao: input.funcaoParticipacao.trim(),
      p_mensagem: input.mensagem?.trim() || null,
      p_grupo_disputa_id: input.grupoDisputaId?.trim() || null,
    });

    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<{ success: boolean; error: string | null; convite_id: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao enviar convite.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível enviar o convite.' };

    const conviteId = row.convite_id ?? undefined;
    if (conviteId) {
      void dispararNotificacaoPushConviteParticipacao(conviteId).catch((err) =>
        console.warn('[convite participação] Erro ao notificar convidado principal (convite já salvo):', err)
      );
    }

    return { success: true, error: null, conviteId };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

/** Notificação in-app + push FCM para um convite já persistido. */
async function dispararNotificacaoPushConviteParticipacao(conviteId: string): Promise<void> {
  const { data: notifyData, error: notifyErr } = await supabase.rpc('rpc_app_notificar_convite_participacao_evento', {
    p_convite_id: conviteId,
  });

  if (notifyErr) {
    console.warn('[convite participação] Falha RPC de notificação:', notifyErr.message);
    return;
  }

  const row = pickRpcRow<{
    success: boolean;
    error: string | null;
    token_fcm: string | null;
    title: string | null;
    message: string | null;
  }>(notifyData);

  if (!row?.success) {
    console.warn('[convite participação] RPC não notificou:', row?.error || 'erro desconhecido');
    return;
  }

  const tokenFcm = row.token_fcm;
  if (!tokenFcm) return;

  // Payload `data` do FCM: dados do convite (sem cidade/descrição). WhatsApp só se foi informado no envio.
  const { data: conviteRow } = await supabase
    .from('convite_participacao_evento')
    .select(
      'nome_evento, data_evento, hora_inicio, hora_fim, funcao_participacao, mensagem, cache_valor, telefone_contratante',
    )
    .eq('id', conviteId)
    .maybeSingle();

  const pushData: Record<string, string> = {
    screen: 'convites_participacao',
    type: 'convite_participacao_evento',
    convite_id: conviteId,
  };
  if (conviteRow) {
    if (conviteRow.nome_evento != null) pushData.nome_evento = String(conviteRow.nome_evento);
    if (conviteRow.data_evento != null) pushData.data_evento = String(conviteRow.data_evento);
    if (conviteRow.hora_inicio != null) pushData.hora_inicio = String(conviteRow.hora_inicio);
    if (conviteRow.hora_fim != null) pushData.hora_fim = String(conviteRow.hora_fim);
    if (conviteRow.funcao_participacao != null) pushData.funcao_participacao = String(conviteRow.funcao_participacao);
    if (conviteRow.mensagem != null && String(conviteRow.mensagem).trim() !== '') {
      pushData.mensagem = String(conviteRow.mensagem);
    }
    if (conviteRow.cache_valor != null) pushData.cache_valor = String(conviteRow.cache_valor);
    const tel = conviteRow.telefone_contratante != null ? String(conviteRow.telefone_contratante).trim() : '';
    if (tel !== '') pushData.telefone_whatsapp = tel;
  }

  const { error: pushErr } = await supabase.functions.invoke('send-push-single', {
    body: {
      token: tokenFcm,
      title: row.title || 'Convite de participação em evento',
      body: row.message || 'Você recebeu um novo convite de participação.',
      data: pushData,
    },
  });

  if (pushErr) {
    // Fallback legado, caso a função nova ainda não tenha sido deployada.
    const { error: legacyPushErr } = await supabase.functions.invoke('send-push-notification', {
      body: {
        token: tokenFcm,
        title: row.title || 'Convite de participação em evento',
        body: row.message || 'Você recebeu um novo convite de participação.',
        data: pushData,
      },
    });
    if (legacyPushErr) {
      console.warn('[convite participação] Falha no push do convidado principal:', legacyPushErr.message);
    }
  }
}

/**
 * Leilão: um RPC cria vários convites com o mesmo grupo_disputa_id (quem aceitar primeiro cancela os demais).
 */
export async function enviarConvitesParticipacaoLeilaoLote(
  input: EnviarConvitesLeilaoInput
): Promise<{ ok: boolean; error: string | null; resultados: ResultadoLinhaLeilao[] }> {
  try {
    const ids = [...new Set(input.artistaConvidadoIds.map((x) => x?.trim()).filter(Boolean))] as string[];
    if (ids.length === 0) {
      return { ok: false, error: 'Selecione pelo menos um artista.', resultados: [] };
    }
    if (input.cacheValor == null || Number(input.cacheValor) <= 0) {
      return { ok: false, error: 'Informe o cachê do convite (obrigatório).', resultados: [] };
    }
    if (!input.funcaoParticipacao?.trim()) {
      return { ok: false, error: 'Informe a função do participante (obrigatório).', resultados: [] };
    }
    const filtered = ids.filter((id) => id !== input.artistaQueConvidaId);
    if (filtered.length === 0) {
      return { ok: false, error: 'Nenhum artista válido para convidar.', resultados: [] };
    }

    const { data, error } = await supabase.rpc('rpc_app_enviar_convites_participacao_evento_lote', {
      p_evento_origem_id: input.eventoOrigemId,
      p_artista_convidado_ids: filtered,
      p_cache_valor: Number(input.cacheValor),
      p_telefone_contratante: input.telefoneContratante?.trim() || null,
      p_funcao_participacao: input.funcaoParticipacao.trim(),
      p_mensagem: input.mensagem?.trim() || null,
    });

    if (error) return { ok: false, error: error.message, resultados: [] };

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as {
      artista_convidado_id: string | null;
      success: boolean;
      error: string | null;
      convite_id: string | null;
    }[];

    if (rows.length === 0) {
      return { ok: false, error: 'Resposta vazia do servidor.', resultados: [] };
    }

    const batchRow = rows.find((r) => r.artista_convidado_id == null);
    if (batchRow && batchRow.success === false && batchRow.error) {
      return { ok: false, error: batchRow.error, resultados: [] };
    }

    const resultados: ResultadoLinhaLeilao[] = rows
      .filter((r) => r.artista_convidado_id != null)
      .map((r) => ({
        artistaConvidadoId: String(r.artista_convidado_id),
        success: r.success === true,
        error: r.error ?? null,
        conviteId: r.convite_id != null ? String(r.convite_id) : undefined,
      }));

    const okCount = resultados.filter((r) => r.success).length;
    for (const r of resultados) {
      if (r.success && r.conviteId) {
        void dispararNotificacaoPushConviteParticipacao(r.conviteId).catch((err) =>
          console.warn('[convite participação leilão] Falha push para', r.artistaConvidadoId, err)
        );
      }
    }

    return {
      ok: okCount > 0,
      error: okCount === 0 ? 'Nenhum convite foi enviado.' : null,
      resultados,
    };
  } catch {
    return { ok: false, error: 'Erro de conexão', resultados: [] };
  }
}

export async function recusarConviteParticipacao(
  conviteId: string,
  options?: { motivo?: string | null; usuarioRecusouId?: string | null }
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_recusar_convite_participacao_evento', {
      p_convite_id: conviteId,
      p_motivo: options?.motivo?.trim() || null,
    });
    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<RpcSimpleResult>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao recusar convite.' };
    return { success: row.success, error: row.error };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function cancelarConviteParticipacao(
  conviteId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_cancelar_convite_pendente_participacao_evento', {
      p_convite_id: conviteId,
    });
    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<RpcSimpleResult>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao cancelar convite.' };
    return { success: row.success, error: row.error };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

/** Cancela uma participação já aceita (lado do convidado), exigindo motivo. */
export async function cancelarParticipacaoAceita(
  conviteId: string,
  motivo: string,
  usuarioCancelaId?: string | null
): Promise<{ success: boolean; error: string | null }> {
  try {
    void usuarioCancelaId;
    const motivoLimpo = motivo?.trim() || '';
    if (!motivoLimpo) return { success: false, error: 'Informe o motivo do cancelamento.' };

    const { data, error } = await supabase.rpc('rpc_app_cancelar_participacao_aceita_evento', {
      p_convite_id: conviteId,
      p_motivo: motivoLimpo,
    });
    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<RpcSimpleResult>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao cancelar participação.' };
    return { success: row.success, error: row.error };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

/** Remove participação já aceita (lado do organizador do evento): despesa, evento do convidado e notificação. */
export async function removerParticipacaoAceitaPeloOrganizador(
  conviteId: string,
  motivo: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const motivoLimpo = motivo?.trim() || '';
    if (!motivoLimpo) return { success: false, error: 'Informe o motivo da remoção.' };

    const { data, error } = await supabase.rpc('rpc_app_cancelar_participacao_aceita_pelo_anfitriao_evento', {
      p_convite_id: conviteId,
      p_motivo: motivoLimpo,
    });
    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<RpcSimpleResult>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao remover participação.' };
    return { success: row.success, error: row.error };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

/** Aceita o convite: cria linha em `events` na agenda do convidado e atualiza o convite. */
export async function aceitarConviteParticipacao(
  conviteId: string,
  userId: string,
  artistaConvidadoId: string,
  options?: { funcaoParticipacao?: string | null }
): Promise<{ success: boolean; error: string | null; eventoId?: string }> {
  try {
    void userId;
    void artistaConvidadoId;
    void options;

    const { data, error } = await supabase.rpc('rpc_app_aceitar_convite_participacao_evento', {
      p_convite_id: conviteId,
    });
    if (error) return { success: false, error: error.message };

    const row = pickRpcRow<{ success: boolean; error: string | null; evento_id: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao aceitar convite.' };
    return { success: row.success, error: row.error, eventoId: row.evento_id ?? undefined };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function obterNomeArtista(artistId: string): Promise<string | null> {
  const { data } = await supabase.from('artists').select('name').eq('id', artistId).maybeSingle();
  return data?.name ?? null;
}

export interface SalvarAvaliacaoParticipacaoInput {
  conviteId: string;
  notaGeral: number;
  notaPontualidade?: number | null;
  notaProfissionalismo?: number | null;
  notaQualidadeTecnica?: number | null;
  notaComunicacao?: number | null;
  comentarioPublico?: string | null;
  observacaoPrivada?: string | null;
}

export async function salvarAvaliacaoParticipacaoEvento(
  input: SalvarAvaliacaoParticipacaoInput
): Promise<{ success: boolean; error: string | null; avaliacaoId?: string }> {
  return confirmarShowEAvaliar({
    ...input,
    confirmarShow: true,
  });
}

export interface ConfirmarShowEAvaliarInput extends SalvarAvaliacaoParticipacaoInput {
  confirmarShow: boolean;
}

export async function confirmarShowEAvaliar(
  input: ConfirmarShowEAvaliarInput
): Promise<{ success: boolean; error: string | null; avaliacaoId?: string }> {
  try {
    const payload = {
      p_convite_id: input.conviteId,
      p_nota_geral: Number(input.notaGeral),
      p_confirmar_show: input.confirmarShow,
      p_nota_pontualidade: input.notaPontualidade != null ? Number(input.notaPontualidade) : null,
      p_nota_profissionalismo: input.notaProfissionalismo != null ? Number(input.notaProfissionalismo) : null,
      p_nota_qualidade_tecnica: input.notaQualidadeTecnica != null ? Number(input.notaQualidadeTecnica) : null,
      p_nota_comunicacao: input.notaComunicacao != null ? Number(input.notaComunicacao) : null,
      p_comentario_publico: input.comentarioPublico?.trim() || null,
      p_observacao_privada: input.observacaoPrivada?.trim() || null,
    };

    let { data, error } = await supabase.rpc('rpc_app_confirmar_show_e_avaliar', payload);

    if (error && /schema cache|Could not find the function/i.test(error.message)) {
      const legado = await supabase.rpc('rpc_app_salvar_avaliacao_participacao_evento', {
        p_convite_id: payload.p_convite_id,
        p_nota_geral: payload.p_nota_geral,
        p_nota_pontualidade: payload.p_nota_pontualidade,
        p_nota_profissionalismo: payload.p_nota_profissionalismo,
        p_nota_qualidade_tecnica: payload.p_nota_qualidade_tecnica,
        p_nota_comunicacao: payload.p_nota_comunicacao,
        p_comentario_publico: payload.p_comentario_publico,
        p_observacao_privada: payload.p_observacao_privada,
      });
      data = legado.data;
      error = legado.error;
    }

    if (error) {
      const missing = /schema cache|Could not find the function/i.test(error.message);
      return {
        success: false,
        error: missing
          ? 'A confirmação do show ainda não está no banco. Rode o script FIX_CONFIRMAR_SHOW_AVALIAR.sql no Supabase.'
          : error.message,
      };
    }
    const row = pickRpcRow<{ success: boolean; error: string | null; avaliacao_id: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao confirmar show.' };
    return {
      success: row.success,
      error: row.error,
      avaliacaoId: row.avaliacao_id ?? undefined,
    };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export interface ResumoReputacaoArtista {
  artista_id: string;
  media_nota_geral: number | null;
  total_avaliacoes: number;
  shows_realizados: number;
  anuncios_feed_ativos: number;
  negociacoes_aceitas: number;
}

export async function listarResumoReputacaoArtistas(
  artistaIds: string[]
): Promise<{ resumo: ResumoReputacaoArtista[]; error: string | null }> {
  try {
    const ids = [...new Set((artistaIds || []).map((x) => x?.trim()).filter(Boolean))];
    if (ids.length === 0) return { resumo: [], error: null };
    const { data, error } = await supabase.rpc('rpc_app_resumo_reputacao_artistas', {
      p_artista_ids: ids,
    });
    if (error) return { resumo: [], error: error.message };
    const rows = ((data as Record<string, unknown>[]) || []).map((row) => {
      const mediaRaw = row.media_nota_geral;
      const media =
        mediaRaw == null || mediaRaw === '' ? null : Number.isFinite(Number(mediaRaw)) ? Number(mediaRaw) : null;
      return {
        artista_id: String(row.artista_id),
        media_nota_geral: media,
        total_avaliacoes: Number(row.total_avaliacoes ?? 0) || 0,
        shows_realizados: Number(row.shows_realizados ?? 0) || 0,
        anuncios_feed_ativos: Number(row.anuncios_feed_ativos ?? 0) || 0,
        negociacoes_aceitas: Number(row.negociacoes_aceitas ?? 0) || 0,
      } as ResumoReputacaoArtista;
    });
    return { resumo: rows, error: null };
  } catch {
    return { resumo: [], error: 'Erro de conexão' };
  }
}

export async function listarAvaliacoesParticipacaoEvento(
  eventoOrigemId: string
): Promise<{ avaliacoes: AvaliacaoParticipacaoEventoRow[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_listar_avaliacoes_participacao_evento', {
      p_evento_origem_id: eventoOrigemId,
    });
    if (error) return { avaliacoes: [], error: error.message };
    return { avaliacoes: ((data as AvaliacaoParticipacaoEventoRow[]) || []), error: null };
  } catch {
    return { avaliacoes: [], error: 'Erro de conexão' };
  }
}

export async function listarResumoAvaliacoesArtistasParaConvite(
  artistaIds: string[]
): Promise<{ resumo: ResumoAvaliacaoArtistaConvite[]; error: string | null }> {
  try {
    const ids = [...new Set((artistaIds || []).map((x) => x?.trim()).filter(Boolean))];
    if (ids.length === 0) return { resumo: [], error: null };
    const { data, error } = await supabase.rpc('rpc_app_resumo_avaliacoes_artistas_para_convite', {
      p_artista_ids: ids,
    });
    if (error) return { resumo: [], error: error.message };
    const rows = ((data as Record<string, unknown>[]) || []).map((row) => {
      const mediaRaw = row.media_nota_geral;
      const media =
        mediaRaw == null || mediaRaw === '' ? null : Number.isFinite(Number(mediaRaw)) ? Number(mediaRaw) : null;
      const totalRaw = row.total_avaliacoes;
      const total = totalRaw == null || totalRaw === '' ? 0 : Number(totalRaw);
      return {
        artista_avaliado_id: String(row.artista_avaliado_id),
        media_nota_geral: media,
        total_avaliacoes: Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0,
        comentario_publico_recente:
          row.comentario_publico_recente != null && String(row.comentario_publico_recente).trim() !== ''
            ? String(row.comentario_publico_recente).trim()
            : null,
      } as ResumoAvaliacaoArtistaConvite;
    });
    return { resumo: rows, error: null };
  } catch {
    return { resumo: [], error: 'Erro de conexão' };
  }
}

export interface ObservacaoPrivadaMinhaAvaliacao {
  convite_participacao_evento_id: string;
  evento_origem_id: string;
  observacao_privada: string;
  nota_geral: number;
  nome_evento: string | null;
  data_evento: string | null;
  artista_convidado_id: string;
  artista_convidado_nome: string;
  criado_em: string;
}

export async function listarObservacoesPrivadasMinhasAvaliacoes(
  artistaAvaliadorId: string,
  limite: number = 50
): Promise<{ itens: ObservacaoPrivadaMinhaAvaliacao[]; error: string | null }> {
  try {
    const capped = Math.min(100, Math.max(1, Math.floor(limite)));
    const { data, error } = await supabase.rpc('rpc_app_listar_observacoes_privadas_minhas_avaliacoes', {
      p_artista_avaliador_id: artistaAvaliadorId,
      p_limite: capped,
    });
    if (error) return { itens: [], error: error.message };
    const itens: ObservacaoPrivadaMinhaAvaliacao[] = ((data as Record<string, unknown>[]) || []).map((row) => ({
      convite_participacao_evento_id: String(row.convite_participacao_evento_id),
      evento_origem_id: String(row.evento_origem_id),
      observacao_privada: String(row.observacao_privada ?? ''),
      nota_geral: Number(row.nota_geral),
      nome_evento: row.nome_evento != null ? String(row.nome_evento) : null,
      data_evento:
        row.data_evento != null && String(row.data_evento).trim() !== ''
          ? String(row.data_evento).slice(0, 10)
          : null,
      artista_convidado_id: String(row.artista_convidado_id),
      artista_convidado_nome: String(row.artista_convidado_nome ?? 'Artista'),
      criado_em: String(row.criado_em ?? ''),
    }));
    return { itens, error: null };
  } catch {
    return { itens: [], error: 'Erro de conexão' };
  }
}

export async function listarAvaliacoesPublicasArtistaParaConvite(
  artistaAvaliadoId: string,
  limite: number = 30
): Promise<{ avaliacoes: AvaliacaoPublicaArtistaConvite[]; error: string | null }> {
  try {
    const capped = Math.min(100, Math.max(1, Math.floor(limite)));
    const { data, error } = await supabase.rpc('rpc_app_listar_avaliacoes_publicas_artista', {
      p_artista_avaliado_id: artistaAvaliadoId,
      p_limite: capped,
    });
    if (error) return { avaliacoes: [], error: error.message };
    const rows = ((data as Record<string, unknown>[]) || []).map((row) => ({
      nota_geral: Number(row.nota_geral),
      comentario_publico: String(row.comentario_publico ?? ''),
      criado_em: String(row.criado_em ?? ''),
      artista_avaliador_id: String(row.artista_avaliador_id ?? ''),
      artista_avaliador_nome: String(row.artista_avaliador_nome ?? 'Artista'),
      artista_avaliador_imagem:
        row.artista_avaliador_imagem != null && String(row.artista_avaliador_imagem).trim() !== ''
          ? String(row.artista_avaliador_imagem)
          : null,
      nome_evento: row.nome_evento != null ? String(row.nome_evento) : null,
    }));
    return { avaliacoes: rows, error: null };
  } catch {
    return { avaliacoes: [], error: 'Erro de conexão' };
  }
}
