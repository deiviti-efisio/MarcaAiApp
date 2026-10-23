import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import {
  extractInstagramShortcode,
  extractInstagramUsername,
  extractYoutubeId,
  instagramAppUserUrl,
  parseSpotifyEmbed,
  youtubeEmbedUrl,
  youtubeThumbnailCandidates,
  youtubeWatchUrl,
  type SocialPreviewItem,
} from '../lib/socialLinks';

const ACCENT: Record<SocialPreviewItem['kind'], string> = {
  youtube: '#FF0000',
  spotify: '#1DB954',
  instagram: '#E4405F',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function youtubePlayerHtml(videoId: string): string {
  const src = escapeHtml(youtubeEmbedUrl(videoId));
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <iframe
      src="${src}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowfullscreen
    ></iframe>
  </body>
</html>`;
}

function spotifyPlayerHtml(embedUrl: string): string {
  const src = escapeHtml(embedUrl);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: 0; border-radius: 12px; }
    </style>
  </head>
  <body>
    <iframe
      src="${src}"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
    ></iframe>
  </body>
</html>`;
}

function instagramEmbedPage(embedHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: transparent; }
      .instagram-media { min-width: 0 !important; max-width: 100% !important; width: 100% !important; }
    </style>
  </head>
  <body>
    ${embedHtml}
    <script async src="https://www.instagram.com/embed.js"></script>
    <script>
      window.addEventListener('load', function () {
        if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();
      });
    </script>
  </body>
</html>`;
}

async function tryOpenUrls(urls: string[]) {
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // tenta o próximo esquema / https
    }
  }
}

async function fetchOEmbed(
  url: string,
  kind: SocialPreviewItem['kind']
): Promise<{ title?: string; thumbnail?: string; author?: string; html?: string }> {
  try {
    const endpoint =
      kind === 'spotify'
        ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
        : kind === 'instagram'
          ? `https://graph.facebook.com/v26.0/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true&hidecaption=false&maxwidth=320`
          : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint);
    if (!res.ok) return {};
    const json = (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
      author_name?: string;
      html?: string;
      error?: string;
    };
    if (json.error) return {};
    return {
      title: json.title,
      thumbnail: json.thumbnail_url,
      author: json.author_name,
      html: json.html,
    };
  } catch {
    return {};
  }
}

type Props = {
  item: SocialPreviewItem;
  featured?: boolean;
  subtitle?: string;
};

export default function SocialMediaPreviewCard({ item, featured, subtitle }: Props) {
  const { colors } = useTheme();
  const [title, setTitle] = useState(item.title);
  const [thumb, setThumb] = useState(item.thumbnailUrl);
  const [author, setAuthor] = useState('');
  const [playing, setPlaying] = useState(false);
  const [instagramHtml, setInstagramHtml] = useState<string | null>(null);
  const [thumbIndex, setThumbIndex] = useState(0);

  const youtubeId = useMemo(
    () => (item.kind === 'youtube' ? extractYoutubeId(item.url) : null),
    [item.kind, item.url]
  );
  const youtubeThumbs = useMemo(
    () => (youtubeId ? youtubeThumbnailCandidates(youtubeId) : []),
    [youtubeId]
  );
  const spotify = useMemo(
    () => (item.kind === 'spotify' ? parseSpotifyEmbed(item.url) : null),
    [item.kind, item.url]
  );
  const instagramUser = useMemo(
    () => (item.kind === 'instagram' ? extractInstagramUsername(item.url) : null),
    [item.kind, item.url]
  );
  const instagramCode = useMemo(
    () => (item.kind === 'instagram' ? extractInstagramShortcode(item.url) : null),
    [item.kind, item.url]
  );

  const isFeatured = featured || item.kind === 'youtube' || item.kind === 'instagram' || item.kind === 'spotify';
  const displayThumb = youtubeThumbs[thumbIndex] || thumb;

  useEffect(() => {
    setTitle(item.title);
    setThumb(item.thumbnailUrl);
    setAuthor('');
    setPlaying(false);
    setInstagramHtml(null);
    setThumbIndex(0);
    void fetchOEmbed(item.url, item.kind).then((meta) => {
      if (meta.title) setTitle(meta.title);
      if (meta.thumbnail) setThumb(meta.thumbnail);
      if (meta.author) setAuthor(meta.author);
      if (item.kind === 'instagram' && meta.html) setInstagramHtml(meta.html);
    });
  }, [item.url, item.kind, item.title, item.thumbnailUrl]);

  const icon =
    item.kind === 'youtube'
      ? 'logo-youtube'
      : item.kind === 'spotify'
        ? 'musical-notes'
        : 'logo-instagram';

  const caption =
    subtitle?.trim() ||
    author ||
    (item.kind === 'youtube' ? 'YouTube' : item.kind === 'instagram' ? 'Instagram' : item.title);

  const openExternal = () => {
    if (item.kind === 'youtube' && youtubeId) {
      void tryOpenUrls([
        `youtube://www.youtube.com/watch?v=${youtubeId}`,
        `vnd.youtube://${youtubeId}`,
        youtubeWatchUrl(youtubeId),
      ]);
      return;
    }
    if (item.kind === 'spotify' && spotify) {
      void tryOpenUrls([spotify.uri, item.url]);
      return;
    }
    if (item.kind === 'instagram') {
      const urls = [
        instagramUser ? instagramAppUserUrl(instagramUser) : '',
        item.url,
      ].filter(Boolean);
      void tryOpenUrls(urls);
      return;
    }
    void Linking.openURL(item.url);
  };

  const webViewChrome = {
    allowsInlineMediaPlayback: true,
    mediaPlaybackRequiresUserAction: false,
    javaScriptEnabled: true,
    domStorageEnabled: true,
    originWhitelist: ['*'] as string[],
    allowsFullscreenVideo: true,
    nestedScrollEnabled: true,
    scrollEnabled: false,
    setSupportMultipleWindows: false,
  };

  const appLabel =
    item.kind === 'youtube'
      ? 'Abrir no YouTube'
      : item.kind === 'spotify'
        ? 'Abrir no Spotify'
        : 'Abrir no Instagram';
  const metaLine =
    item.kind === 'instagram'
      ? instagramUser
        ? `@${instagramUser}`
        : instagramCode
          ? 'Publicação'
          : 'Instagram'
      : caption;

  const canPlayInApp =
    Boolean(youtubeId) || Boolean(spotify) || Boolean(instagramHtml);

  const renderCover = (onPress: () => void) => (
    <TouchableOpacity style={styles.fill} onPress={onPress} activeOpacity={0.92}>
      {displayThumb ? (
        <Image
          source={{ uri: displayThumb }}
          style={styles.fill}
          contentFit="cover"
          onError={() => {
            if (thumbIndex < youtubeThumbs.length - 1) setThumbIndex((i) => i + 1);
          }}
        />
      ) : (
        <View style={[styles.fill, styles.thumbFallback, { backgroundColor: `${ACCENT[item.kind]}22` }]}>
          <Ionicons name={icon} size={42} color={ACCENT[item.kind]} />
        </View>
      )}
      <View style={styles.featuredDim} />
      <View style={styles.featuredPlayWrap} pointerEvents="none">
        <View style={[styles.featuredPlay, { backgroundColor: `${ACCENT[item.kind]}EE` }]}>
          <Ionicons
            name={item.kind === 'instagram' ? 'logo-instagram' : 'play'}
            size={26}
            color="#fff"
            style={item.kind === 'instagram' ? undefined : { marginLeft: 3 }}
          />
        </View>
      </View>
    </TouchableOpacity>
  );

  if (isFeatured) {
    let media = renderCover(() => (canPlayInApp ? setPlaying(true) : openExternal()));
    if (playing && youtubeId) {
      media = (
        <WebView
          source={{ html: youtubePlayerHtml(youtubeId), baseUrl: 'https://www.youtube.com' }}
          style={styles.fill}
          {...webViewChrome}
        />
      );
    } else if (playing && spotify) {
      media = (
        <WebView
          source={{ html: spotifyPlayerHtml(spotify.embedUrl), baseUrl: 'https://open.spotify.com' }}
          style={styles.fill}
          {...webViewChrome}
        />
      );
    } else if (playing && instagramHtml) {
      media = (
        <WebView
          source={{ html: instagramEmbedPage(instagramHtml), baseUrl: 'https://www.instagram.com' }}
          style={styles.fill}
          {...webViewChrome}
          scrollEnabled
        />
      );
    }

    return (
      <View style={[styles.shell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.media}>{media}</View>
        <View style={styles.metaBar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.metaTitle, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {metaLine ? (
              <Text style={[styles.metaSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {metaLine}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={openExternal} style={styles.appBtn} hitSlop={8}>
            <Ionicons name={icon} size={16} color={ACCENT[item.kind]} />
            <Text style={[styles.appBtnText, { color: ACCENT[item.kind] }]}>{appLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={openExternal}
      activeOpacity={0.88}
    >
      {displayThumb ? (
        <Image source={{ uri: displayThumb }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumbFallback, { backgroundColor: `${ACCENT[item.kind]}22` }]}>
          <Ionicons name={icon} size={28} color={ACCENT[item.kind]} />
        </View>
      )}
      {item.kind !== 'instagram' ? (
        <View style={styles.play}>
          <Ionicons name="play" size={18} color="#fff" />
        </View>
      ) : null}
      <View style={[styles.caption, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <Ionicons name={icon} size={14} color="#fff" />
        <Text style={styles.captionText} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  fill: { width: '100%', height: '100%' },
  featuredDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  featuredPlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredPlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  metaTitle: { fontSize: 14, fontWeight: '800' },
  metaSub: { fontSize: 12, marginTop: 2 },
  appBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  appBtnText: { fontSize: 12, fontWeight: '700' },
  card: {
    width: 260,
    height: 148,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 12,
  },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: 52,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    left: 110,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  captionText: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1 },
});
