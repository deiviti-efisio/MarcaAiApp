import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { extractYoutubeId, type SocialPreviewItem } from '../lib/socialLinks';

const ACCENT: Record<SocialPreviewItem['kind'], string> = {
  youtube: '#FF0000',
  spotify: '#1DB954',
  instagram: '#E4405F',
};

async function fetchOEmbed(
  url: string,
  kind: SocialPreviewItem['kind']
): Promise<{ title?: string; thumbnail?: string; author?: string }> {
  try {
    const endpoint =
      kind === 'spotify'
        ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
        : kind === 'instagram'
          ? `https://noembed.com/embed?url=${encodeURIComponent(url)}`
          : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint);
    if (!res.ok) return {};
    const json = (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
      author_name?: string;
      error?: string;
    };
    if (json.error) return {};
    return { title: json.title, thumbnail: json.thumbnail_url, author: json.author_name };
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
  const youtubeId = useMemo(
    () => (item.kind === 'youtube' ? extractYoutubeId(item.url) : null),
    [item.kind, item.url]
  );
  const isFeatured = featured || item.kind === 'youtube' || item.kind === 'instagram';

  useEffect(() => {
    setTitle(item.title);
    setThumb(item.thumbnailUrl);
    setAuthor('');
    setPlaying(false);
    void fetchOEmbed(item.url, item.kind).then((meta) => {
      if (meta.title) setTitle(meta.title);
      if (meta.thumbnail) setThumb(meta.thumbnail);
      if (meta.author) setAuthor(meta.author);
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
  const embedUri = youtubeId
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`
    : null;

  const openExternal = () => {
    void Linking.openURL(item.url);
  };

  if (isFeatured) {
    return (
      <View style={[styles.featured, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {playing && embedUri ? (
          <WebView
            source={{ uri: embedUri }}
            style={styles.featuredMedia}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            allowsFullscreenVideo
          />
        ) : (
          <TouchableOpacity style={styles.featuredMedia} onPress={() => (youtubeId ? setPlaying(true) : openExternal())} activeOpacity={0.92}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.featuredMedia} contentFit="cover" />
            ) : (
              <View style={[styles.featuredMedia, styles.thumbFallback, { backgroundColor: `${ACCENT[item.kind]}22` }]}>
                <Ionicons name={icon} size={42} color={ACCENT[item.kind]} />
              </View>
            )}
            <View style={styles.featuredDim} />
            <View style={styles.featuredPlayWrap} pointerEvents="none">
              <View style={styles.featuredPlay}>
                <Ionicons
                  name={item.kind === 'instagram' ? 'logo-instagram' : 'play'}
                  size={item.kind === 'instagram' ? 28 : 28}
                  color="#fff"
                  style={item.kind === 'instagram' ? undefined : { marginLeft: 3 }}
                />
              </View>
            </View>
            <View style={styles.featuredCaption}>
              <Text style={styles.featuredTitle} numberOfLines={2}>
                {title}
              </Text>
              {caption ? (
                <Text style={styles.featuredSub} numberOfLines={2}>
                  {caption}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={openExternal}
      activeOpacity={0.88}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
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
  featured: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  featuredMedia: { width: '100%', height: '100%' },
  featuredDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  featuredPlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 28,
  },
  featuredPlay: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredCaption: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  featuredTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  featuredSub: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
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
