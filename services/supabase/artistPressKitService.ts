import { supabase } from '../../lib/supabase';
import { removeArtistPressKitFileByUrl } from './artistPressKitUploadService';

/** Limite por artista. */
export const PRESS_KIT_MAX_LINKS = 10;
export const PRESS_KIT_MAX_FILES = 10;

export type ArtistPressKitItemType = 'link' | 'file';

async function countPressKitByType(artistId: string, itemType: ArtistPressKitItemType): Promise<number> {
  const { count, error } = await supabase
    .from('artist_press_kit_items')
    .select('*', { count: 'exact', head: true })
    .eq('artist_id', artistId)
    .eq('item_type', itemType);
  if (error) return 0;
  return count ?? 0;
}

export interface ArtistPressKitItem {
  id: string;
  artist_id: string;
  item_type: ArtistPressKitItemType;
  title: string;
  url: string;
  storage_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function listarPressKitPublicoArtista(
  artistId: string
): Promise<{ items: ArtistPressKitItem[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('listar_press_kit_publico_artista', {
      p_artist_id: artistId,
    });
    if (error) {
      return listArtistPressKitItems(artistId);
    }
    return { items: (data as ArtistPressKitItem[]) ?? [], error: null };
  } catch {
    return listArtistPressKitItems(artistId);
  }
}

export async function listArtistPressKitItems(
  artistId: string
): Promise<{ items: ArtistPressKitItem[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('artist_press_kit_items')
      .select('*')
      .eq('artist_id', artistId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return { items: [], error: error.message };
    }
    return { items: (data as ArtistPressKitItem[]) ?? [], error: null };
  } catch {
    return { items: [], error: 'Erro ao carregar materiais' };
  }
}

export async function addArtistPressKitLink(
  artistId: string,
  title: string,
  url: string
): Promise<{ item: ArtistPressKitItem | null; error: string | null }> {
  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();
  if (!trimmedTitle || !trimmedUrl) {
    return { item: null, error: 'Título e URL são obrigatórios.' };
  }

  try {
    const linkCount = await countPressKitByType(artistId, 'link');
    if (linkCount >= PRESS_KIT_MAX_LINKS) {
      return {
        item: null,
        error: `No press kit você pode ter no máximo ${PRESS_KIT_MAX_LINKS} links.`,
      };
    }

    const { count } = await supabase
      .from('artist_press_kit_items')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId);

    const sortOrder = count ?? 0;

    const { data, error } = await supabase
      .from('artist_press_kit_items')
      .insert({
        artist_id: artistId,
        item_type: 'link',
        title: trimmedTitle,
        url: trimmedUrl,
        storage_path: null,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return { item: null, error: error.message };
    }
    return { item: data as ArtistPressKitItem, error: null };
  } catch {
    return { item: null, error: 'Erro ao salvar link' };
  }
}

export async function addArtistPressKitFile(
  artistId: string,
  title: string,
  publicUrl: string,
  storagePath: string
): Promise<{ item: ArtistPressKitItem | null; error: string | null }> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { item: null, error: 'Título é obrigatório.' };
  }

  try {
    const fileCount = await countPressKitByType(artistId, 'file');
    if (fileCount >= PRESS_KIT_MAX_FILES) {
      return {
        item: null,
        error: `No press kit você pode ter no máximo ${PRESS_KIT_MAX_FILES} arquivos.`,
      };
    }

    const { count } = await supabase
      .from('artist_press_kit_items')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId);

    const sortOrder = count ?? 0;

    const { data, error } = await supabase
      .from('artist_press_kit_items')
      .insert({
        artist_id: artistId,
        item_type: 'file',
        title: trimmedTitle,
        url: publicUrl,
        storage_path: storagePath,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return { item: null, error: error.message };
    }
    return { item: data as ArtistPressKitItem, error: null };
  } catch {
    return { item: null, error: 'Erro ao salvar arquivo' };
  }
}

export async function deleteArtistPressKitItem(
  item: ArtistPressKitItem
): Promise<{ success: boolean; error: string | null }> {
  try {
    if (item.item_type === 'file' && item.url) {
      const rem = await removeArtistPressKitFileByUrl(item.url);
      if (!rem.success) {
        // Continua tentando remover o registro; arquivo órfão pode ser limpo depois
      }
    }

    const { error } = await supabase.from('artist_press_kit_items').delete().eq('id', item.id);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch {
    return { success: false, error: 'Erro ao remover item' };
  }
}

/**
 * Texto para compartilhar: links vão com URL; arquivos aparecem só pelo título (o binário sai pelo `sharePressKitItems`).
 */
export function buildPressKitShareMessage(artistName: string, items: ArtistPressKitItem[]): string {
  const displayName = (artistName || '').trim() || 'Artista';
  const links = items.filter((i) => i.item_type === 'link');
  const files = items.filter((i) => i.item_type === 'file');
  const parts: string[] = [
    `Press kit / materiais — ${displayName}`,
    `Artista: ${displayName}`,
    '',
  ];
  if (links.length > 0) {
    parts.push('Links:', ...links.map((it) => `• ${it.title}: ${it.url}`));
  }
  if (files.length > 0) {
    if (links.length > 0) parts.push('');
    parts.push('Arquivos (cada um será enviado em seguida como documento pelo sistema):');
    parts.push(...files.map((f) => `• ${f.title}`));
  }
  return parts.join('\n');
}
