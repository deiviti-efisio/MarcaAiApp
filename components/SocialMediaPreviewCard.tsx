import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import type { SocialPreviewItem } from '../lib/socialLinks';

const ACCENT: Record<SocialPreviewItem['kind'], string> = {
  youtube: '#FF0000',
  spotify: '#1DB954',
  instagram: '#E4405F',
};

async function fetchOEmbedTitle(url: string, kind: SocialPreviewItem['kind']): Promise<{ title?: string; thumbnail?: string }> {
  try {
    const endpoint =
      kind === 'spotify'
        ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
        : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint);
    if (!res.ok) return {};
    const json = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: json.title, thumbnail: json.thumbnail_url };
  } catch {
    return {};
  }
}

export default function SocialMediaPreviewCard({ item }: { item: SocialPreviewItem }) {
  const { colors } = useTheme();
  const [title, setTitle] = useState(item.title);
  const [thumb, setThumb] = useState(item.thumbnailUrl);

  useEffect(() => {
    setTitle(item.title);
    setThumb(item.thumbnailUrl);
    if (item.kind === 'instagram') return;
    void fetchOEmbedTitle(item.url, item.kind).then((meta) => {
      if (meta.title) setTitle(meta.title);
      if (meta.thumbnail) setThumb(meta.thumbnail);
    });
  }, [item.url, item.kind, item.title, item.thumbnailUrl]);

  const icon =
    item.kind === 'youtube'
      ? 'logo-youtube'
      : item.kind === 'spotify'
        ? 'musical-notes'
        : 'logo-instagram';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => void Linking.openURL(item.url)}
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
