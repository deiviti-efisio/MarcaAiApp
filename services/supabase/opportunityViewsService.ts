import { supabase } from '../../lib/supabase';

export type OportunidadeVisualizacao = {
  artistId: string;
  artistName: string;
  artistImage: string | null;
  viewedAt: string;
};

export async function registrarVisualizacaoOportunidade(
  eventoId: string,
  artistaId: string
): Promise<void> {
  const { error } = await supabase.rpc('rpc_app_registrar_visualizacao_oportunidade', {
    p_evento_id: eventoId,
    p_artista_id: artistaId,
  });
  if (error) return;
}

export async function listarVisualizacoesOportunidade(
  eventoId: string
): Promise<{ items: OportunidadeVisualizacao[]; error: string | null }> {
  const { data, error } = await supabase.rpc('rpc_app_listar_visualizacoes_oportunidade', {
    p_evento_id: eventoId,
  });
  if (error) return { items: [], error: error.message };
  const items = ((data || []) as Record<string, unknown>[]).map((row) => ({
    artistId: String(row.artist_id || ''),
    artistName: String(row.artist_name || 'Artista'),
    artistImage: row.artist_image != null ? String(row.artist_image) : null,
    viewedAt: String(row.viewed_at || ''),
  })).filter((item) => item.artistId);
  return { items, error: null };
}

export async function listarVisualizacoesDoArtista(
  artistaId: string
): Promise<{ byEvent: Record<string, OportunidadeVisualizacao[]>; error: string | null }> {
  const { data, error } = await supabase.rpc('rpc_app_listar_visualizacoes_artista', {
    p_artista_id: artistaId,
  });
  if (error) return { byEvent: {}, error: error.message };
  const byEvent: Record<string, OportunidadeVisualizacao[]> = {};
  ((data || []) as Record<string, unknown>[]).forEach((row) => {
    const eventId = String(row.event_id || '');
    const artistId = String(row.artist_id || '');
    if (!eventId || !artistId) return;
    if (!byEvent[eventId]) byEvent[eventId] = [];
    byEvent[eventId].push({
      artistId,
      artistName: String(row.artist_name || 'Artista'),
      artistImage: row.artist_image != null ? String(row.artist_image) : null,
      viewedAt: String(row.viewed_at || ''),
    });
  });
  return { byEvent, error: null };
}
