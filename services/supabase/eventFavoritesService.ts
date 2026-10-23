import { supabase } from '../../lib/supabase';
import { getActiveArtist } from '../artistContext';
import { getUserPermissions } from './permissionsService';

export async function listarIdsEventosFavoritos(): Promise<Set<string>> {
  const { data, error } = await supabase.from('event_favorites').select('event_id');
  if (error || !data) return new Set();
  return new Set(
    data
      .map((row) => (row.event_id != null ? String(row.event_id) : ''))
      .filter(Boolean),
  );
}

export async function alternarEventoFavorito(
  eventId: string,
  currentlyFavorite: boolean
): Promise<{ favorite: boolean; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { favorite: currentlyFavorite, error: 'Faça login para favoritar.' };

  const activeArtist = await getActiveArtist();
  if (!activeArtist?.id) {
    return { favorite: currentlyFavorite, error: 'Selecione um artista para favoritar.' };
  }
  const permissions = await getUserPermissions(userId, activeArtist.id, { skipCache: true });
  const role = permissions?.role;
  if (role !== 'admin' && role !== 'vendedor') {
    return {
      favorite: currentlyFavorite,
      error: 'Somente admin ou vendedor pode favoritar oportunidades.',
    };
  }

  const id = eventId.trim();
  if (!id) return { favorite: currentlyFavorite, error: 'Oportunidade inválida.' };

  if (currentlyFavorite) {
    const { error } = await supabase
      .from('event_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('event_id', id);
    if (error) return { favorite: true, error: error.message };
    return { favorite: false, error: null };
  }

  const { error } = await supabase.from('event_favorites').insert({
    user_id: userId,
    event_id: id,
  });
  if (error) {
    if (error.code === '23505') return { favorite: true, error: null };
    return { favorite: false, error: error.message };
  }
  return { favorite: true, error: null };
}
