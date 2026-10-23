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
import PublicAgendaCalendar from '../components/PublicAgendaCalendar';
import { collectSocialPreviewItems, parseArtistSocialLinks } from '../lib/socialLinks';
import { getArtistPublicProfile, type Artist } from '../services/supabase/artistService';
import {
  alternarArtistaFavorito,
  listarIdsArtistasFavoritos,
} from '../services/supabase/artistFavoritesService';
import { listarAgendaPublicaArtista, type PublicAgendaEvent } from '../services/supabase/eventService';

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
  const [publicEvents, setPublicEvents] = useState<PublicAgendaEvent[]>([]);
  const [favorito, setFavorito] = useState(false);

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
    const [profileRes, agendaRes, favoriteIds] = await Promise.all([
      getArtistPublicProfile(artistId),
      listarAgendaPublicaArtista(artistId),
      listarIdsArtistasFavoritos(),
    ]);
    setArtist(profileRes.artist);
    setPublicEvents(agendaRes.events);
    setFavorito(favoriteIds.has(artistId));
  }, [artistId]);

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
    if (!activeArtist?.id) {
      Alert.alert('Conversa', 'Selecione um artista para iniciar o bate-papo.');
      return;
    }
    if (!artistId || isOwn) return;
    router.push({
      pathname: '/conversa',
      params: {
        artistId,
        artistName: artist?.name || '',
        artistImage: artist?.profile_url || '',
      },
    });
  };

  const youtubePreviews = previews.filter((item) => item.kind === 'youtube');
  const instagramPreviews = previews.filter((item) => item.kind === 'instagram');
  const otherPreviews = previews.filter((item) => item.kind !== 'youtube' && item.kind !== 'instagram');
  const videoSubtitle = (artist?.bio || '').trim();

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
          <TouchableOpacity
            onPress={() => {
              if (!artistId) return;
              const was = favorito;
              setFavorito(!was);
              void alternarArtistaFavorito(artistId, was).then(({ favorite, error }) => {
                if (error) setFavorito(was);
                else setFavorito(favorite);
              });
            }}
            style={styles.iconBtn}
            hitSlop={10}
          >
            <Ionicons name={favorito ? 'heart' : 'heart-outline'} size={22} color={favorito ? '#EF4444' : colors.text} />
          </TouchableOpacity>
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
              <View style={styles.bioBlock}>
                <Text style={[styles.bioLabel, { color: colors.textSecondary }]}>Sobre a carreira</Text>
                <Text style={[styles.bio, { color: colors.text }]}>{artist.bio}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              {!isOwn ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={handleConversar}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>Conversar</Text>
                </TouchableOpacity>
              ) : null}
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

          {youtubePreviews.length ? (
            <View style={[styles.section, styles.sectionPad]}>
              <View style={styles.sectionHead}>
                <Ionicons name="play-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Vídeos</Text>
              </View>
              <View style={styles.videoStack}>
                {youtubePreviews.map((item, index) => (
                  <SocialMediaPreviewCard
                    key={item.url}
                    item={item}
                    featured
                    subtitle={index === 0 ? videoSubtitle : undefined}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {instagramPreviews.length ? (
            <View style={[styles.section, styles.sectionPad]}>
              <View style={styles.sectionHead}>
                <Ionicons name="logo-instagram" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Instagram</Text>
              </View>
              <View style={styles.videoStack}>
                {instagramPreviews.map((item) => (
                  <SocialMediaPreviewCard key={item.url} item={item} featured />
                ))}
              </View>
            </View>
          ) : null}

          {otherPreviews.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="musical-notes-outline" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Músicas e redes</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.previewRow}
              >
                {otherPreviews.map((item) => (
                  <SocialMediaPreviewCard key={item.url} item={item} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Agenda pública</Text>
            </View>
            <PublicAgendaCalendar events={publicEvents} colors={colors} />
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
  bioBlock: { marginTop: 12 },
  bioLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  bio: { fontSize: 15, lineHeight: 22, marginTop: 6 },
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
  sectionPad: { paddingRight: 20 },
  videoStack: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingRight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  previewRow: { paddingRight: 20 },
});
