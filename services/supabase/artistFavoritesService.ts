import { isAbortError } from '../../lib/abortError';
import { supabase } from '../../lib/supabase';
import {
  ARTISTAS_BUSCA_PAGE_SIZE,
  type ArtistaBuscaConvite,
} from './conviteParticipacaoEventoService';

function mapRow(row: Record<string, unknown>): ArtistaBuscaConvite {
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
    city: row.city != null ? String(row.city) : null,
    state: row.state != null ? String(row.state) : null,
    tem_show_hoje:
      row.tem_show_hoje === true ||
      row.tem_show_hoje === 't' ||
      row.tem_show_hoje === 'true' ||
      row.tem_show_hoje === 1,
  };
}

export async function listarIdsArtistasFavoritos(): Promise<Set<string>> {
  const { data, error } = await supabase.from('artist_favorites').select('artist_id');
  if (error || !data) return new Set();
  return new Set(
    data
      .map((row) => (row.artist_id != null ? String(row.artist_id) : ''))
      .filter(Boolean),
  );
}

export async function alternarArtistaFavorito(
  artistId: string,
  currentlyFavorite: boolean
): Promise<{ favorite: boolean; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { favorite: currentlyFavorite, error: 'Faça login para favoritar.' };

  if (currentlyFavorite) {
    const { error } = await supabase
      .from('artist_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('artist_id', artistId);
    if (error) return { favorite: true, error: error.message };
    return { favorite: false, error: null };
  }

  const { error } = await supabase.from('artist_favorites').insert({
    user_id: userId,
    artist_id: artistId,
  });
  if (error) {
    if (error.code === '23505') return { favorite: true, error: null };
    return { favorite: false, error: error.message };
  }
  return { favorite: true, error: null };
}

export async function listarArtistasFavoritos(params: {
  artistaAtualId?: string | null;
  cidade?: string | null;
  estado?: string | null;
  termo?: string | null;
  funcao?: string | null;
  genero?: string | null;
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
  const genero = (params.genero || '').trim();

  try {
    let query = supabase.rpc('listar_artistas_favoritos', {
      p_artista_atual_id: params.artistaAtualId ?? null,
      p_cidade: cidade.length >= 2 ? cidade : null,
      p_estado: estado.length > 0 ? estado : null,
      p_termo: termo.length >= 2 ? termo : null,
      p_funcao: funcao.length >= 2 ? funcao : null,
      p_genero: genero.length > 0 ? genero : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (params.abortSignal) query = query.abortSignal(params.abortSignal);
    const { data, error } = await query;
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    if (error) return { artists: [], hasMore: false, error: error.message };
    const artists = ((data || []) as Record<string, unknown>[]).map(mapRow);
    return { artists, hasMore: artists.length >= limit, error: null };
  } catch (error) {
    if (params.abortSignal?.aborted || isAbortError(error)) {
      return { artists: [], hasMore: false, error: null, aborted: true };
    }
    return { artists: [], hasMore: false, error: 'Erro de conexão' };
  }
}
