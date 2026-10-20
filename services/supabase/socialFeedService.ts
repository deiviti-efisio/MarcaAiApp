import { supabase } from '../../lib/supabase';

export type SocialMediaType = 'image' | 'video';

export interface SocialPost {
  id: string;
  artist_id: string;
  artist_name: string;
  artist_image: string | null;
  body: string;
  location: string | null;
  created_at: string;
  media_type: SocialMediaType | null;
  media_url: string | null;
  thumbnail_url: string | null;
  likes_count: number;
  comments_count: number;
  is_mine: boolean;
  liked_by_me: boolean;
}

export interface SocialComment {
  id: string;
  post_id: string;
  artist_id: string;
  artist_name: string;
  artist_image: string | null;
  message: string;
  created_at: string;
  likes_count: number;
  liked_by_me: boolean;
}

function pickRpcRow<T extends object>(data: T[] | T | null): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function mapPost(row: Record<string, unknown>): SocialPost {
  const mediaType = row.media_type === 'video' ? 'video' : row.media_type === 'image' ? 'image' : null;
  return {
    id: String(row.id),
    artist_id: String(row.artist_id),
    artist_name: String(row.artist_name ?? 'Artista'),
    artist_image: row.artist_image != null ? String(row.artist_image) : null,
    body: String(row.body ?? ''),
    location: row.location != null ? String(row.location) : null,
    created_at: String(row.created_at ?? ''),
    media_type: mediaType,
    media_url: row.media_url != null ? String(row.media_url) : null,
    thumbnail_url: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    likes_count: Number(row.likes_count ?? 0) || 0,
    comments_count: Number(row.comments_count ?? 0) || 0,
    is_mine: asBoolean(row.is_mine),
    liked_by_me: asBoolean(row.liked_by_me),
  };
}

function mapComment(row: Record<string, unknown>): SocialComment {
  return {
    id: String(row.id),
    post_id: String(row.post_id),
    artist_id: String(row.artist_id),
    artist_name: String(row.artist_name ?? 'Artista'),
    artist_image: row.artist_image != null ? String(row.artist_image) : null,
    message: String(row.message ?? ''),
    created_at: String(row.created_at ?? ''),
    likes_count: Number(row.likes_count ?? 0) || 0,
    liked_by_me: asBoolean(row.liked_by_me),
  };
}

export async function listarFeedSocial(params: {
  artistaAtualId?: string | null;
  somenteMeus?: boolean;
}): Promise<{ posts: SocialPost[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('listar_feed_social', {
      p_artista_atual_id: params.artistaAtualId ?? null,
      p_somente_meus: params.somenteMeus ?? false,
    });
    if (error) return { posts: [], error: error.message };
    const rows = (data || []) as Record<string, unknown>[];
    return { posts: rows.map(mapPost), error: null };
  } catch {
    return { posts: [], error: 'Erro de conexão' };
  }
}

export async function listarFeedSocialArtista(params: {
  artistId: string;
  artistaAtualId?: string | null;
}): Promise<{ posts: SocialPost[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('listar_feed_social_artista', {
      p_artist_id: params.artistId,
      p_artista_atual_id: params.artistaAtualId ?? null,
    });
    if (error) {
      const fallback = await listarFeedSocial({
        artistaAtualId: params.artistaAtualId,
        somenteMeus: false,
      });
      return {
        posts: fallback.posts.filter((post) => post.artist_id === params.artistId),
        error: fallback.error,
      };
    }
    const rows = (data || []) as Record<string, unknown>[];
    return { posts: rows.map(mapPost), error: null };
  } catch {
    return { posts: [], error: 'Erro de conexão' };
  }
}

export async function publicarSocialPost(input: {
  artistaId: string;
  body?: string | null;
  mediaUrl: string;
  mediaType: SocialMediaType;
  thumbnailUrl?: string | null;
  location?: string | null;
}): Promise<{ success: boolean; error: string | null; postId?: string }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_publicar_social_post', {
      p_artista_id: input.artistaId,
      p_body: input.body?.trim() || '',
      p_media_url: input.mediaUrl,
      p_media_type: input.mediaType,
      p_thumbnail_url: input.thumbnailUrl?.trim() || null,
      p_location: input.location?.trim() || null,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{ success: boolean; error: string | null; post_id: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao publicar.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível publicar.' };
    return { success: true, error: null, postId: row.post_id ?? undefined };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function removerSocialPost(
  postId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_remover_social_post', {
      p_post_id: postId,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{ success: boolean; error: string | null }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao remover.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível remover.' };
    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function alternarCurtidaSocialPost(input: {
  postId: string;
  artistaId: string;
}): Promise<{
  success: boolean;
  error: string | null;
  liked?: boolean;
  likesCount?: number;
}> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_alternar_curtida_social_post', {
      p_post_id: input.postId,
      p_artista_id: input.artistaId,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{
      success: boolean;
      error: string | null;
      liked: boolean;
      likes_count: number;
    }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao curtir.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível curtir.' };
    return {
      success: true,
      error: null,
      liked: row.liked,
      likesCount: Number(row.likes_count ?? 0) || 0,
    };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function listarComentariosSocialPost(
  postId: string,
  artistaAtualId?: string | null
): Promise<{ comments: SocialComment[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('listar_comentarios_social_post', {
      p_post_id: postId,
      p_artista_atual_id: artistaAtualId ?? null,
    });
    if (error) return { comments: [], error: error.message };
    const rows = (data || []) as Record<string, unknown>[];
    return { comments: rows.map(mapComment), error: null };
  } catch {
    return { comments: [], error: 'Erro de conexão' };
  }
}

export async function comentarSocialPost(input: {
  postId: string;
  artistaId: string;
  message: string;
}): Promise<{
  success: boolean;
  error: string | null;
  commentId?: string;
  commentsCount?: number;
}> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_comentar_social_post', {
      p_post_id: input.postId,
      p_artista_id: input.artistaId,
      p_message: input.message,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{
      success: boolean;
      error: string | null;
      comment_id: string | null;
      comments_count: number;
    }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao comentar.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível comentar.' };
    return {
      success: true,
      error: null,
      commentId: row.comment_id ?? undefined,
      commentsCount: Number(row.comments_count ?? 0) || 0,
    };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}

export async function alternarCurtidaSocialComentario(input: {
  commentId: string;
  artistaId: string;
}): Promise<{
  success: boolean;
  error: string | null;
  liked?: boolean;
  likesCount?: number;
}> {
  try {
    const { data, error } = await supabase.rpc('rpc_app_alternar_curtida_social_comentario', {
      p_comment_id: input.commentId,
      p_artista_id: input.artistaId,
    });
    if (error) return { success: false, error: error.message };
    const row = pickRpcRow<{
      success: boolean;
      error: string | null;
      liked: boolean;
      likes_count: number;
    }>(data);
    if (!row) return { success: false, error: 'Resposta inválida ao curtir.' };
    if (!row.success) return { success: false, error: row.error || 'Não foi possível curtir.' };
    return {
      success: true,
      error: null,
      liked: row.liked,
      likesCount: Number(row.likes_count ?? 0) || 0,
    };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
}
