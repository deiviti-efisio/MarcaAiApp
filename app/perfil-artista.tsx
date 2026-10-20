import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../components/OptimizedImage';
import SocialMediaPreviewCard from '../components/SocialMediaPreviewCard';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatEventLocationSlash } from '../lib/brazilGeo';
import { formatCalendarDate } from '../lib/dateUtils';
import { collectSocialPreviewItems, parseArtistSocialLinks } from '../lib/socialLinks';
import { getArtistPublicProfile, type Artist } from '../services/supabase/artistService';
import { listarFeedMarketplace, type FeedAnuncio } from '../services/supabase/feedMarketplaceService';
import { listarFeedSocialArtista, type SocialPost } from '../services/supabase/socialFeedService';

function digitsPhone(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function styleChips(artist: Artist | null): string[] {
  if (!artist) return [];
  const out: string[] = [];
  const style = (artist.musical_style || '').trim();
  if (style) {
    style.split(/[·,;/|]+/).forEach((part) => {
      const t = part.trim();
      if (t) out.push(t);
    });
  }
  (artist.work_roles || []).forEach((role) => {
    if (role && !out.includes(role)) out.push(role);
  });
  return out.slice(0, 8);
}

export default function PerfilArtistaScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const params = useLocalSearchParams<{ artistId?: string }>();
  const artistId = typeof params.artistId === 'string' ? params.artistId : '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [shows, setShows] = useState<FeedAnuncio[]>([]);

  const isOwn = !!activeArtist?.id && activeArtist.id === artistId;
  const previews = useMemo(
    () => collectSocialPreviewItems(parseArtistSocialLinks(artist?.social_links)),
    [artist?.social_links]
  );

  const load = useCallback(async () => {
    if (!artistId) {
      setLoading(false);
      return;
    }
    const [profileRes, postsRes, feedRes] = await Promise.all([
      getArtistPublicProfile(artistId),
      listarFeedSocialArtista({ artistId, artistaAtualId: activeArtist?.id }),
      listarFeedMarketplace({ filtro: 'todos', artistaAtualId: activeArtist?.id }),
    ]);
    setArtist(profileRes.artist);
    setPosts(postsRes.posts.filter((post) => post.media_url));
    const today = new Date().toISOString().slice(0, 10);
    setShows(
      feedRes.anuncios
        .filter((item) => item.artist_id === artistId && item.event_date >= today)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
        .slice(0, 12)
    );
  }, [activeArtist?.id, artistId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleConversar = () => {
    const phone = digitsPhone(artist?.whatsapp);
    if (!phone) {
      Alert.alert(
        'Contato',
        'Este artista não deixou WhatsApp visível no perfil. Use o feed para negociar um show.'
      );
      return;
    }
    void Linking.openURL(`https://wa.me/55${phone.replace(/^55/, '')}`);
  };

  const locationLine = artist
    ? [artist.city, artist.state].filter(Boolean).join(' · ')
    : '';
  const chips = styleChips(artist);
  const initial = (artist?.name || '?').trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.text }]}>Perfil</Text>
        {isOwn ? (
          <TouchableOpacity
            onPress={() => router.push('/editar-artista')}
            style={styles.iconBtn}
            hitSlop={10}
          >
            <Ionicons name="create-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !artist ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>Não foi possível abrir este perfil.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <View style={styles.hero}>
            {artist.cover_url ? (
              <Image source={{ uri: artist.cover_url }} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.cover, { backgroundColor: `${colors.primary}22` }]} />
            )}
            <View style={styles.avatarWrap}>
              {artist.profile_url ? (
                <OptimizedImage
                  imageUrl={artist.profile_url}
                  style={styles.avatar}
                  fallbackText={initial}
                  fallbackIconSize={28}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.avatarLetter, { color: colors.primary }]}>{initial}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.identity}>
            <Text style={[styles.name, { color: colors.text }]}>{artist.name}</Text>
            {chips.length ? (
              <Text style={[styles.roles, { color: colors.textSecondary }]} numberOfLines={2}>
                {chips.slice(0, 3).join(' · ')}
              </Text>
            ) : null}
            {locationLine ? (
              <View style={styles.locRow}>
                <Ionicons name="location-outline" size={14} color={colors.primary} />
                <Text style={[styles.locText, { color: colors.textSecondary }]}>{locationLine}</Text>
              </View>
            ) : null}
            {chips.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {chips.map((chip) => (
                  <View
                    key={chip}
                    style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  >
                    <Text style={[styles.chipText, { color: colors.text }]}>{chip}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {artist.bio ? (
              <Text style={[styles.bio, { color: colors.text }]}>{artist.bio}</Text>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={handleConversar}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Conversar</Text>
              </TouchableOpacity>
              {previews.map((item) => (
                <TouchableOpacity
                  key={item.kind + item.url}
                  style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => void Linking.openURL(item.url)}
                >
                  <Ionicons
                    name={
                      item.kind === 'youtube'
                        ? 'logo-youtube'
                        : item.kind === 'spotify'
                          ? 'musical-notes'
                          : 'logo-instagram'
                    }
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {previews.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="play-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Vídeos e músicas</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.previewRow}
              >
                {previews.map((item) => (
                  <SocialMediaPreviewCard key={item.url} item={item} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {posts.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="images-outline" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>No feed</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.previewRow}
              >
                {posts.slice(0, 8).map((post) => (
                  <TouchableOpacity
                    key={post.id}
                    style={[styles.postThumb, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => router.push('/feed')}
                    activeOpacity={0.88}
                  >
                    <Image
                      source={{ uri: post.thumbnail_url || post.media_url || '' }}
                      style={styles.postThumbImg}
                      contentFit="cover"
                    />
                    {post.media_type === 'video' ? (
                      <View style={styles.postPlay}>
                        <Ionicons name="play" size={16} color="#fff" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Agenda pública</Text>
            </View>
            {shows.length === 0 ? (
              <Text style={[styles.emptyAgenda, { color: colors.textSecondary }]}>
                Nenhuma data pública no feed por enquanto.
              </Text>
            ) : (
              shows.map((item) => (
                <View
                  key={item.id}
                  style={[styles.showRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View>
                    <Text style={[styles.showDate, { color: colors.primary }]}>
                      {formatCalendarDate(item.event_date)}
                    </Text>
                    <Text style={[styles.showTime, { color: colors.textSecondary }]}>
                      {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.showName, { color: colors.text }]} numberOfLines={1}>
                      {item.evento_nome || (item.feed_tipo === 'demanda' ? 'Procurando' : 'Disponível')}
                    </Text>
                    <Text style={[styles.showLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                      {formatEventLocationSlash(item) || 'Local a combinar'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 40 },
  hero: { height: 168, marginBottom: 48 },
  cover: { width: '100%', height: 168 },
  avatarWrap: {
    position: 'absolute',
    left: 20,
    bottom: -40,
    width: 92,
    height: 92,
    borderRadius: 46,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff',
  },
  avatar: { width: '100%', height: '100%' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 32, fontWeight: '700' },
  identity: { paddingHorizontal: 20, paddingTop: 8 },
  name: { fontSize: 26, fontWeight: '800' },
  roles: { marginTop: 4, fontSize: 14 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  locText: { fontSize: 13 },
  chipsRow: { gap: 8, paddingVertical: 12 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  bio: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  socialBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: 24, paddingLeft: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingRight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  previewRow: { paddingRight: 20 },
  postThumb: {
    width: 168,
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  postThumbImg: { width: '100%', height: '100%' },
  postPlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAgenda: { paddingRight: 20, fontSize: 14, lineHeight: 20 },
  showRow: {
    marginRight: 20,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  showDate: { fontSize: 13, fontWeight: '700' },
  showTime: { fontSize: 12, marginTop: 2 },
  showName: { fontSize: 15, fontWeight: '600' },
  showLoc: { fontSize: 12, marginTop: 2 },
});
