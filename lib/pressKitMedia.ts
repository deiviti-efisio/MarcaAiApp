import type { ArtistPressKitItem } from '../services/supabase/artistPressKitService';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac|mpeg)(?:$|\?)/i;

export function isPressKitAudio(item: ArtistPressKitItem): boolean {
  const haystack = `${item.url} ${item.storage_path || ''} ${item.title}`;
  return AUDIO_EXT.test(haystack);
}
