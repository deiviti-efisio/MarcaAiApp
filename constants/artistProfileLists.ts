/** Opções sugeridas para `artists.work_roles` (JSONB array de strings). */
export const ARTIST_WORK_ROLE_PRESETS = [
  'Cantor',
  'Vocalista',
  'Backing vocal',
  'Guitarrista',
  'Violonista',
  'Baixista',
  'Baterista',
  'Tecladista',
  'Sanfoneiro',
  'Saxofonista',
  'Percussionista',
  'DJ',
  'MC',
  'Compositor',
  'Arranjador',
  'Produtor musical',
  'Roadie',
  'Técnico de som',
  'Iluminador',
  'Operador de palco',
  'Diretor de palco',
  'Técnico de backline',
  'Contrarregra',
  'Bailarino',
  'Coreógrafo',
  'Técnico de vídeo',
  'Fotógrafo',
  'Videomaker',
  'Produtor de eventos',
] as const;

/** Estilos musicais do cadastro (`artists.musical_style`). */
export const ARTIST_MUSICAL_STYLE_PRESETS = [
  'Alternative',
  'Arrocha',
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

/** Formação de palco — o que o contratante precisa para encaixar o show. */
export const ARTIST_SHOW_FORMAT_PRESETS = [
  'Solo',
  'Voz e violão',
  'Duo',
  'Trio',
  'Banda',
  'DJ',
] as const;

const SHOW_FORMAT_ALIASES: Record<string, string> = {
  'Show solo': 'Solo',
  'Banda completa': 'Banda',
  'Orquestra / big band': 'Banda',
  'DJ set': 'DJ',
  Acústico: 'Voz e violão',
};

const SHOW_FORMAT_IRRELEVANT = new Set([
  'Cerimônia',
  'Festa / animação',
  'Palco / festival',
  'Bar / restaurante',
]);

export function parseArtistStringArrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

/** Remove tipo de festa/local e unifica nomes antigos. */
export function normalizeShowFormats(value: unknown): string[] {
  const out: string[] = [];
  for (const raw of parseArtistStringArrayFromJson(value)) {
    if (SHOW_FORMAT_IRRELEVANT.has(raw)) continue;
    const mapped = SHOW_FORMAT_ALIASES[raw] || raw;
    if (!mapped) continue;
    if (out.some((item) => item.toLowerCase() === mapped.toLowerCase())) continue;
    out.push(mapped);
  }
  return out;
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
