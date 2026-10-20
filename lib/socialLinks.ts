export type ArtistSocialLinks = {
  youtube?: string;
  spotify?: string;
  instagram?: string;
  videos?: string[];
};

export type SocialPreviewKind = 'youtube' | 'spotify' | 'instagram';

export type SocialPreviewItem = {
  kind: SocialPreviewKind;
  url: string;
  title: string;
  thumbnailUrl?: string;
};

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

function asUrlList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseArtistSocialLinks(raw: unknown): ArtistSocialLinks {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }

  const youtube = firstString(obj.youtube);
  const spotify = firstString(obj.spotify);
  const instagram = firstString(obj.instagram);
  const videos = asUrlList(obj.videos);

  const out: ArtistSocialLinks = {};
  if (youtube) out.youtube = youtube;
  if (spotify) out.spotify = spotify;
  if (instagram) out.instagram = instagram;
  if (videos.length) out.videos = videos;
  return out;
}

export function socialLinksToJson(links: ArtistSocialLinks): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (links.youtube?.trim()) out.youtube = links.youtube.trim();
  if (links.spotify?.trim()) out.spotify = links.spotify.trim();
  if (links.instagram?.trim()) out.instagram = links.instagram.trim();
  const videos = (links.videos || []).map((item) => item.trim()).filter(Boolean);
  if (videos.length) out.videos = videos;
  return out;
}

function withHttps(url: string): string {
  const t = url.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(withHttps(url));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function detectSocialKind(url: string): SocialPreviewKind | null {
  const t = url.trim().toLowerCase();
  if (!t) return null;
  if (t.includes('youtu.be') || t.includes('youtube.com')) return 'youtube';
  if (t.includes('spotify.com') || t.includes('spotify.link')) return 'spotify';
  if (t.includes('instagram.com') || t.includes('instagr.am')) return 'instagram';
  return null;
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function collectSocialPreviewItems(links: ArtistSocialLinks): SocialPreviewItem[] {
  const seen = new Set<string>();
  const items: SocialPreviewItem[] = [];

  const push = (urlRaw: string) => {
    const url = withHttps(urlRaw);
    if (!url) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    const kind = detectSocialKind(url);
    if (!kind) return;
    seen.add(key);
    if (kind === 'youtube') {
      const id = extractYoutubeId(url);
      items.push({
        kind,
        url: id ? `https://www.youtube.com/watch?v=${id}` : url,
        title: 'YouTube',
        thumbnailUrl: id ? youtubeThumbnailUrl(id) : undefined,
      });
      return;
    }
    if (kind === 'spotify') {
      items.push({ kind, url, title: 'Spotify' });
      return;
    }
    items.push({ kind, url, title: 'Instagram' });
  };

  if (links.youtube) push(links.youtube);
  if (links.spotify) push(links.spotify);
  if (links.instagram) push(links.instagram);
  (links.videos || []).forEach(push);
  return items;
}

export function isLikelyHttpUrl(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(t);
}
