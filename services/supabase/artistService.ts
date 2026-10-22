import { supabase } from '../../lib/supabase';
import {
  parseArtistSocialLinks,
  type ArtistSocialLinks,
} from '../../lib/socialLinks';
import { parseArtistStringArrayFromJson } from '../../constants/artistProfileLists';
import { normalizeArtistMemberRole } from './permissionsService';
import { canCreateArtist, FREE_PLAN_MAX_OWNED_ARTIST_PROFILES } from './userService';

export interface Artist {
  id: string;
  name: string;
  musical_style?: string;
  profile_url?: string;
  cover_url?: string | null;
  bio?: string | null;
  social_links?: ArtistSocialLinks;
  whatsapp?: string;
  city?: string;
  state?: string;
  is_available_for_gigs?: boolean;
  /** Se true, o WhatsApp pode aparecer na busca de convites a eventos. */
  show_whatsapp?: boolean;
  average_cache_value?: number | null;
  work_roles?: string[];
  show_formats?: string[];
  role?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateArtistData {
  name: string;
  musical_style?: string;
  profile_url?: string;
  cover_url?: string | null;
  bio?: string | null;
  social_links?: ArtistSocialLinks;
  user_id: string;
  whatsapp?: string | null;
  city?: string | null;
  state?: string | null;
  is_available_for_gigs?: boolean;
  show_whatsapp?: boolean;
  average_cache_value?: number | null;
  work_roles?: string[];
  show_formats?: string[];
}

function mapArtistRow(row: Record<string, unknown> | null | undefined): Artist | null {
  if (!row || !row.id) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    musical_style: (row.musical_style as string) || undefined,
    profile_url: (row.profile_url as string) || undefined,
    cover_url: (row.cover_url as string) || null,
    bio: (row.bio as string) || null,
    social_links: parseArtistSocialLinks(row.social_links),
    whatsapp: (row.whatsapp as string) || undefined,
    city: (row.city as string) || undefined,
    state: (row.state as string) || undefined,
    is_available_for_gigs: Boolean(row.is_available_for_gigs),
    show_whatsapp: Boolean(row.show_whatsapp),
    average_cache_value:
      row.average_cache_value == null ? null : Number(row.average_cache_value),
    work_roles: parseArtistStringArrayFromJson(row.work_roles),
    show_formats: parseArtistStringArrayFromJson(row.show_formats),
    role: row.role ? normalizeArtistMemberRole(String(row.role)) : undefined,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapCreateArtistError(message: string): string {
  const m = (message || '').toLowerCase();
  if (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('failed to') ||
    m.includes('timeout')
  ) {
    return 'Sem conexão. Verifique a internet e tente de novo.';
  }
  if (m.includes('jwt') || m.includes('not authenticated') || m.includes('auth')) {
    return 'Sessão expirada. Faça login novamente.';
  }
  if (
    m.includes('row-level security') ||
    m.includes('rls') ||
    m.includes('permission') ||
    m.includes('policy')
  ) {
    return 'Sem permissão para criar o perfil agora. Saia e entre de novo.';
  }
  if (m.includes('duplicate') || m.includes('unique')) {
    return 'Já existe um perfil com esses dados.';
  }
  return message.trim() || 'Não foi possível criar o perfil. Tente de novo.';
}

// Criar perfil do artista
export const createArtist = async (artistData: CreateArtistData): Promise<{ success: boolean; error: string | null; artist?: Artist }> => {
  try {
    const { canCreate, error: limitError } = await canCreateArtist(artistData.user_id);
    if (limitError) {
      return { success: false, error: limitError };
    }
    if (!canCreate) {
      return {
        success: false,
        error: `No plano gratuito você pode criar no máximo ${FREE_PLAN_MAX_OWNED_ARTIST_PROFILES} perfis de artista como administrador. Assine o Premium para criar mais.`,
      };
    }

    // Primeiro, criar o artista
    console.log('📊 [createArtist] Dados enviados:', artistData);
    console.log('📊 [createArtist] Nome:', artistData.name);
    console.log('📊 [createArtist] Musical Style:', artistData.musical_style);
    console.log('📊 [createArtist] Profile URL:', artistData.profile_url);
    console.log('📊 [createArtist] User ID:', artistData.user_id);
    console.log('📊 [createArtist] Created At:', new Date().toISOString());
    console.log('📊 [createArtist] Updated At:', new Date().toISOString());

    const available = artistData.is_available_for_gigs ?? false;
    const { data: artistData_result, error: artistError } = await supabase
      .from('artists')
      .insert({
        name: artistData.name,
        musical_style: artistData.musical_style || null,
        profile_url: artistData.profile_url || null,
        whatsapp: available ? (artistData.whatsapp?.trim() || null) : null,
        city: artistData.city?.trim() || null,
        state: artistData.state?.trim() || null,
        is_available_for_gigs: available,
        show_whatsapp: available ? Boolean(artistData.show_whatsapp) : false,
        average_cache_value: available ? (artistData.average_cache_value ?? null) : null,
        work_roles: available ? (artistData.work_roles || []) : [],
        show_formats: available ? (artistData.show_formats || []) : [],
        bio: artistData.bio?.trim() || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (artistError) {
      const msg = (artistError.message || '').toLowerCase();
      if (msg.includes('bio') && (msg.includes('column') || msg.includes('schema'))) {
        const retry = await supabase
          .from('artists')
          .insert({
            name: artistData.name,
            musical_style: artistData.musical_style || null,
            profile_url: artistData.profile_url || null,
            whatsapp: available ? (artistData.whatsapp?.trim() || null) : null,
            city: artistData.city?.trim() || null,
            state: artistData.state?.trim() || null,
            is_available_for_gigs: available,
            show_whatsapp: available ? Boolean(artistData.show_whatsapp) : false,
            average_cache_value: available ? (artistData.average_cache_value ?? null) : null,
            work_roles: available ? (artistData.work_roles || []) : [],
            show_formats: available ? (artistData.show_formats || []) : [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (!retry.error && retry.data) {
          const { error: memberRetryError } = await supabase.from('artist_members').insert({
            user_id: artistData.user_id,
            artist_id: retry.data.id,
            role: 'admin',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (memberRetryError) {
            await supabase.from('artists').delete().eq('id', retry.data.id);
            return { success: false, error: mapCreateArtistError(memberRetryError.message) };
          }
          return { success: true, error: null, artist: retry.data };
        }
      }
      console.error('❌ Erro ao criar artista:', artistError.message);
      return { success: false, error: mapCreateArtistError(artistError.message) };
    }

    // Depois, criar o relacionamento na tabela artist_members como admin (criador sempre é admin)
    const { error: memberError } = await supabase
      .from('artist_members')
      .insert({
        user_id: artistData.user_id,
        artist_id: artistData_result.id,
        role: 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (memberError) {
      await supabase.from('artists').delete().eq('id', artistData_result.id);
      return { success: false, error: mapCreateArtistError(memberError.message) };
    }

    return { success: true, error: null, artist: artistData_result };
  } catch {
    return { success: false, error: 'Sem conexão. Verifique a internet e tente de novo.' };
  }
};

// Buscar artistas do usuário atual
export const getArtists = async (userId: string): Promise<{ artists: Artist[] | null; error: string | null }> => {
  try {
    // Primeiro, buscar os membros do usuário
    const { data: membersData, error: membersError } = await supabase
      .from('artist_members')
      .select('artist_id, role')
      .eq('user_id', userId);

    if (membersError) {
      return { artists: null, error: membersError.message };
    }

    if (!membersData || membersData.length === 0) {
      return { artists: [], error: null };
    }

    // Buscar os artistas usando os IDs dos membros
    const artistIds = membersData.map(member => member.artist_id);
    const { data: artistsData, error: artistsError } = await supabase
      .from('artists')
      .select('id, name, profile_url, musical_style, created_at, updated_at')
      .in('id', artistIds);

    if (artistsError) {
      return { artists: null, error: artistsError.message };
    }

    // Combinar os dados
    const artists = artistsData?.map(artist => {
      const member = membersData.find(m => m.artist_id === artist.id);
      return {
        id: artist.id,
        name: artist.name,
        profile_url: artist.profile_url,
        musical_style: artist.musical_style,
        role: member ? normalizeArtistMemberRole(String(member.role)) : 'viewer',
        created_at: artist.created_at,
        updated_at: artist.updated_at
      };
    }) || [];

    return { artists, error: null };
  } catch {
    return { artists: null, error: 'Erro de conexão' };
  }
};

/** Lista de artistas para o modal "Excluir conta" (1 RPC em vez de 2 queries). */
export const fetchArtistsForDeleteAccountModal = async (): Promise<{
  artists: Artist[] | null;
  error: string | null;
}> => {
  try {
    const { data, error } = await supabase.rpc('get_delete_account_modal_artists');
    if (error) {
      return { artists: null, error: error.message };
    }
    const raw = data as unknown;
    if (!Array.isArray(raw)) {
      return { artists: [], error: null };
    }
    const artists: Artist[] = raw.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      profile_url: (row.profile_url as string) || undefined,
      musical_style: (row.musical_style as string) || undefined,
      role: normalizeArtistMemberRole(String(row.role || 'viewer')),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }));
    return { artists, error: null };
  } catch {
    return { artists: null, error: 'Erro de conexão' };
  }
};

// Buscar artista por ID
export const getArtistById = async (artistId: string): Promise<{ artist: Artist | null; error: string | null }> => {
  try {
    const { data, error } = await supabase
      .from('artists')
      .select('*')
      .eq('id', artistId)
      .single();

    if (error) {
      return { artist: null, error: error.message };
    }

    return { artist: mapArtistRow(data as Record<string, unknown>), error: null };
  } catch {
    return { artist: null, error: 'Erro de conexão' };
  }
};

export const getArtistPublicProfile = async (
  artistId: string,
): Promise<{ artist: Artist | null; error: string | null }> => {
  try {
    const { data, error } = await supabase.rpc('get_artist_public_profile', {
      p_artist_id: artistId,
    });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      const mapped = mapArtistRow(row as Record<string, unknown> | null);
      if (mapped) return { artist: mapped, error: null };
    }
    return getArtistById(artistId);
  } catch {
    return getArtistById(artistId);
  }
};

// Atualizar artista
export const updateArtist = async (artistId: string, artistData: Partial<CreateArtistData>): Promise<{ success: boolean; error: string | null; artist?: Artist }> => {
  try {
    console.log('🔄 UPDATE ARTIST - Dados enviados:', {
      artistId: artistId,
      name: artistData.name,
      profile_url: artistData.profile_url
    });

    const payload = {
      name: artistData.name,
      profile_url: artistData.profile_url,
      musical_style: artistData.musical_style,
      whatsapp:
        artistData.whatsapp === undefined
          ? undefined
          : artistData.whatsapp === null
            ? null
            : artistData.whatsapp.trim() || null,
      city:
        artistData.city === undefined
          ? undefined
          : artistData.city === null
            ? null
            : artistData.city.trim() || null,
      state:
        artistData.state === undefined
          ? undefined
          : artistData.state === null
            ? null
            : artistData.state.trim() || null,
      is_available_for_gigs: artistData.is_available_for_gigs,
      show_whatsapp: artistData.show_whatsapp,
      average_cache_value:
        artistData.average_cache_value === undefined
          ? undefined
          : artistData.average_cache_value,
      work_roles: artistData.work_roles,
      show_formats: artistData.show_formats,
      cover_url:
        artistData.cover_url === undefined ? undefined : artistData.cover_url,
      bio:
        artistData.bio === undefined
          ? undefined
          : artistData.bio === null
            ? null
            : artistData.bio.trim() || null,
      social_links:
        artistData.social_links === undefined ? undefined : artistData.social_links,
      updated_at: new Date().toISOString()
    };

    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );

    const { data, error } = await supabase
      .from('artists')
      .update(sanitizedPayload)
      .eq('id', artistId)
      .select();

    console.log('📊 UPDATE ARTIST - Resultado:', {
      success: !error,
      error: error?.message,
      dataLength: data?.length,
      updatedArtist: data?.[0]
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      const missingProfileCols =
        msg.includes('cover_url') ||
        msg.includes('social_links') ||
        (msg.includes('bio') && (msg.includes('column') || msg.includes('schema')));
      if (missingProfileCols) {
        const { cover_url: _c, bio: _b, social_links: _s, ...legacy } = sanitizedPayload as Record<
          string,
          unknown
        >;
        const retry = await supabase.from('artists').update(legacy).eq('id', artistId).select();
        if (!retry.error) {
          return {
            success: true,
            error: null,
            artist: mapArtistRow(retry.data?.[0] as Record<string, unknown>) || undefined,
          };
        }
      }
      console.error('❌ UPDATE ARTIST - Erro:', error);
      return { success: false, error: error.message };
    }

    // Retornar o primeiro (e único) resultado
    const updatedArtist = data && data.length > 0 ? data[0] : null;

    console.log('✅ UPDATE ARTIST - Sucesso! Artista atualizado:', {
      id: updatedArtist?.id,
      name: updatedArtist?.name,
      profile_url: updatedArtist?.profile_url
    });

    return {
      success: true,
      error: null,
      artist: mapArtistRow(updatedArtist as Record<string, unknown>) || undefined,
    };
  } catch (err) {
    console.error('💥 UPDATE ARTIST - Erro inesperado:', err);
    return { success: false, error: 'Erro de conexão' };
  }
};

// Deletar artista (com todos os dados relacionados)
export const deleteArtist = async (artistId: string): Promise<{ success: boolean; error: string | null }> => {
  try {
    // 1️⃣ Deletar despesas dos eventos do artista
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('artist_id', artistId);

    if (events && events.length > 0) {
      const eventIds = events.map(e => e.id);
      const { error: expensesError } = await supabase
        .from('event_expenses')
        .delete()
        .in('event_id', eventIds);

      if (expensesError) {
        return { success: false, error: 'Erro ao deletar despesas dos eventos: ' + expensesError.message };
      }
    }

    // 2️⃣ Deletar eventos do artista
    const { error: eventsError } = await supabase
      .from('events')
      .delete()
      .eq('artist_id', artistId);

    if (eventsError) {
      return { success: false, error: 'Erro ao deletar eventos: ' + eventsError.message };
    }

    // 3️⃣ Deletar convites pendentes do artista
    await supabase
      .from('artist_invites')
      .delete()
      .eq('artist_id', artistId);

    // 4️⃣ Deletar colaboradores (artist_members)
    const { error: membersError } = await supabase
      .from('artist_members')
      .delete()
      .eq('artist_id', artistId);

    if (membersError) {
      return { success: false, error: 'Erro ao deletar colaboradores: ' + membersError.message };
    }

    // 5️⃣ Deletar notificações relacionadas ao artista
    await supabase
      .from('notifications')
      .delete()
      .eq('artist_id', artistId);

    // 6️⃣ Finalmente, deletar o artista
    const { error: artistError } = await supabase
      .from('artists')
      .delete()
      .eq('id', artistId);

    if (artistError) {
      return { success: false, error: 'Erro ao deletar artista: ' + artistError.message };
    }

    return { success: true, error: null };

  } catch {
    return { success: false, error: 'Erro de conexão ao deletar artista' };
  }
};
