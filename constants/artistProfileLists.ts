/** Opções sugeridas para `artists.work_roles` (JSONB array de strings). */
export const ARTIST_WORK_ROLE_PRESETS = [
  'Arranjador',
  'Ator',
  'Backing vocal',
  'Baixista',
  'Baterista',
  'Cantor',
  'Compositor',
  'Contrabaixista',
  'Coreógrafo',
  'Dançarino',
  'DJ',
  'Fotógrafo',
  'Guitarrista',
  'Harmonicista',
  'Iluminador',
  'Instrumentista',
  'MC',
  'Percussionista',
  'Produtor musical',
  'Roadie',
  'Roundie',
  'Sanfoneiro',
  'Saxofonista',
  'Tecladista',
  'Técnico de som',
  'Trompetista',
  'Videomaker',
  'Violinista',
  'Violonista',
  'Vocalista',
] as const;

/** Estilos musicais do cadastro (`artists.musical_style`). */
export const ARTIST_MUSICAL_STYLE_PRESETS = [
  'Alternative',
  'Arrocha',
  'Artista Solo',
  'Axé',
  'Baião',
  'Bailão',
  'Bandas do Sul',
  'Bandinhas',
  'Blues',
  'Bossa Nova',
  'Brega',
  'Choro',
  'Country',
  'DJ',
  'Eletrônica',
  'Emo',
  'Folk',
  'Forró',
  'Forró Eletrônico',
  'Frevo',
  'Funk',
  'Funk Carioca',
  'Funk Melody',
  'Gospel',
  'Gospel Contemporâneo',
  'Hard Rock',
  'Hip Hop',
  'House',
  'Indie',
  'Instrumental',
  'Jazz',
  'Maracatu',
  'Metal',
  'MPB',
  'Música Clássica',
  'Música Gaúcha',
  'Pagode',
  'Piseiro',
  'Pop',
  'Pop Rock',
  'Punk',
  'R&B',
  'Rap',
  'Reggae',
  'Reggaeton',
  'Rock',
  'Rock Nacional',
  'Samba',
  'Samba Rock',
  'Sertanejo',
  'Sertanejo Raiz',
  'Sertanejo Universitário',
  'Ska',
  'Soul',
  'Techno',
  'Tradicionalista',
  'Trap',
  'Vanera',
  'Xote',
  'Outros',
] as const;

/** Opções sugeridas para `artists.show_formats` (JSONB array de strings). */
export const ARTIST_SHOW_FORMAT_PRESETS = [
  'Show solo',
  'Duo',
  'Trio',
  'Banda completa',
  'Orquestra / big band',
  'DJ set',
  'Acústico',
  'Voz e violão',
  'Cerimônia',
  'Festa / animação',
  'Palco / festival',
  'Bar / restaurante',
] as const;

export function parseArtistStringArrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function joinArtistStringArrayJson(value: unknown): string {
  const arr = parseArtistStringArrayFromJson(value);
  return arr.length ? arr.join(', ') : '';
}

export function buildOrderedOptionsForPicker(
  presets: readonly string[],
  selected: string[]
): string[] {
  const custom = selected.filter((s) => !presets.includes(s));
  const sortedCustom = [...custom].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return [...presets, ...sortedCustom];
}
