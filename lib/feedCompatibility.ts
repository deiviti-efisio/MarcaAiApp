import { normalizeArtistSearch, normalizeShowFormats } from '../constants/artistProfileLists';
import type { Artist } from '../services/supabase/artistService';

export type PerfilCompat = {
  styles: string[];
  roles: string[];
  formats: string[];
};

export function tokensFromStyle(style?: string | null): string[] {
  if (!style?.trim()) return [];
  return style
    .split(/[·,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function perfilCompatFromArtist(artist: Artist | null | undefined): PerfilCompat | null {
  if (!artist) return null;
  return {
    styles: tokensFromStyle(artist.musical_style),
    roles: (artist.work_roles || []).filter(Boolean),
    formats: normalizeShowFormats(artist.show_formats),
  };
}

function overlap(left: string[], right: string[]): boolean {
  const a = left.map(normalizeArtistSearch).filter((item) => item.length >= 2);
  const b = right.map(normalizeArtistSearch).filter((item) => item.length >= 2);
  if (!a.length || !b.length) return false;
  return a.some((x) => b.some((y) => x === y || x.includes(y) || y.includes(x)));
}

/** Algum estilo, função ou formato da oportunidade coincide com o perfil. Sem dados na vaga → não casa. */
export function oportunidadeCompativelComPerfil(
  anuncio: {
    artist_id?: string;
    musical_style?: string | null;
    feed_funcoes?: string[];
  },
  perfil: PerfilCompat | null,
  meuArtistId?: string | null
): boolean {
  if (!perfil) return false;
  if (meuArtistId && anuncio.artist_id === meuArtistId) return false;
  const opp = [...tokensFromStyle(anuncio.musical_style), ...(anuncio.feed_funcoes || [])];
  const mine = [...perfil.styles, ...perfil.roles, ...perfil.formats];
  return overlap(opp, mine);
}
