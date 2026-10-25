import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import FeaturedShowCard from '../components/FeaturedShowCard';
import PressKitAudioPlayer from '../components/PressKitAudioPlayer';
import PublicAgendaCalendar from '../components/PublicAgendaCalendar';
import ArtistReputationBadge from '../components/ArtistReputationBadge';
import ArtistReviewsModal from '../components/ArtistReviewsModal';
import { isPressKitAudio } from '../lib/pressKitMedia';
import { collectSocialPreviewItems, parseArtistSocialLinks } from '../lib/socialLinks';
import { normalizeShowFormats } from '../constants/artistProfileLists';
import { getArtistPublicProfile, type Artist } from '../services/supabase/artistService';
import {
  alternarArtistaFavorito,
  listarIdsArtistasFavoritos,
} from '../services/supabase/artistFavoritesService';
import { formatCalendarDate, isEventDateAlreadyPast, todayCalendarYmd, toCalendarYmd } from '../lib/dateUtils';
import {
  definirShowDestaquePrincipal,
  listarAgendaPublicaArtista,
  listarShowsDestaqueArtista,
  type FeaturedShow,
  type PublicAgendaEvent,
} from '../services/supabase/eventService';
import {
  listarPressKitPublicoArtista,
  type ArtistPressKitItem,
} from '../services/supabase/artistPressKitService';
import { openWhatsAppConversation } from '../utils/brazilPhone';
import {
  listarAvaliacoesPendentes,
  obterEstatisticasPerfilArtista,
  type AvaliacaoPendente,
  type EstatisticasPerfilArtista,
} from '../services/supabase/contratacaoService';

function styleChips(artist: Artist | null): string[] {
  if (!artist) return [];
  const out: string[] = [];
  const push = (value: string) => {
    const t = value.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const style = (artist.musical_style || '').trim();
  if (style) {
    style.split(/[·,;/|]+/).forEach(push);
  }
  normalizeShowFormats(artist.show_formats).forEach(push);
  (artist.work_roles || []).forEach(push);
  return out.slice(0, 8);
}

export default function PerfilArtistaScreen() {
  const { colors } = useTheme();
  const { isAdmin } = usePermissions();
  const { activeArtist } = useActiveArtistContext();
  const params = useLocalSearchParams<{ artistId?: string }>();
  const artistId = typeof params.artistId === 'string' ? params.artistId : '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [publicEvents, setPublicEvents] = useState<PublicAgendaEvent[]>([]);
  const [featuredShows, setFeaturedShows] = useState<FeaturedShow[]>([]);
  const [featuredMenuOpen, setFeaturedMenuOpen] = useState(false);
  const [savingFeatured, setSavingFeatured] = useState(false);
  const [favorito, setFavorito] = useState(false);
  const [pressKitItems, setPressKitItems] = useState<ArtistPressKitItem[]>([]);
  const [pressKitMenuOpen, setPressKitMenuOpen] = useState(false);
  const [playingPressKit, setPlayingPressKit] = useState<ArtistPressKitItem | null>(null);
  const [stats, setStats] = useState<EstatisticasPerfilArtista | null>(null);
  const [showReviews, setShowReviews] = useState(false);
  const [pendentes, setPendentes] = useState<AvaliacaoPendente[]>([]);

  const isOwn = !!activeArtist?.id && activeArtist.id === artistId;
  const canManagePublicProfile = isOwn && isAdmin;
  const canSocialWithArtists = !isOwn && !!activeArtist?.id;
  const previews = useMemo(
    () => collectSocialPreviewItems(parseArtistSocialLinks(artist?.social_links)),
    [artist?.social_links]
  );
  const presentationFormats = useMemo(
    () => (artist ? normalizeShowFormats(artist.show_formats) : []),
    [artist]
  );

  const load = useCallback(async () => {
    if (!artistId) {
      setLoading(false);
      return;
    }
    const [profileRes, agendaRes, featuredRes, pressKitRes, favoriteIds, statsRes] = await Promise.all([
      getArtistPublicProfile(artistId),
      listarAgendaPublicaArtista(artistId),
      listarShowsDestaqueArtista(artistId),
      listarPressKitPublicoArtista(artistId),
      listarIdsArtistasFavoritos(),
      obterEstatisticasPerfilArtista(artistId),
    ]);
    setArtist(profileRes.artist);
    setPublicEvents(agendaRes.events);
    setFeaturedShows(featuredRes.shows.filter((item) => !isEventDateAlreadyPast(item.event_date)));
    setPressKitItems(pressKitRes.items);
    setFavorito(favoriteIds.has(artistId));
    setStats(statsRes.stats);
    if (activeArtist?.id === artistId) {
      const pend = await listarAvaliacoesPendentes(artistId);
      setPendentes(pend.itens);
    } else {
      setPendentes([]);
    }
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

  const openPressKitItem = (item: ArtistPressKitItem) => {
    setPressKitMenuOpen(false);
    if (isPressKitAudio(item)) {
      setPlayingPressKit(item);
      return;
    }
    void Linking.openURL(item.url);
  };

  const handleOpenPressKit = () => {
    if (pressKitItems.length === 1) {
      openPressKitItem(pressKitItems[0]);
      return;
    }
    if (pressKitItems.length > 1) {
      setPressKitMenuOpen(true);
    }
  };

  const handleSetFeaturedPrincipal = async (show: FeaturedShow) => {
    if (!canManagePublicProfile || show.id === featuredHero?.id || savingFeatured) return;
    setSavingFeatured(true);
    const result = await definirShowDestaquePrincipal(show.id);
    setSavingFeatured(false);
    if (!result.success) {
      Alert.alert('Destaque', result.error || 'Não foi possível definir o destaque principal.');
      return;
    }
    setFeaturedShows((prev) => {
      const next = prev.filter((item) => item.id !== show.id);
      return [{ ...show, featured_at: new Date().toISOString() }, ...next];
    });
    setFeaturedMenuOpen(false);
  };

  const youtubePreviews = previews.filter((item) => item.kind === 'youtube');
  const instagramPreviews = previews.filter((item) => item.kind === 'instagram');
  const spotifyPreviews = previews.filter((item) => item.kind === 'spotify');
  const otherPreviews = previews.filter(
    (item) => item.kind !== 'youtube' && item.kind !== 'instagram' && item.kind !== 'spotify'
  );
  const videoSubtitle = (artist?.bio || '').trim();
  const featuredHero = featuredShows[0] ?? null;

  const locationLine = artist
    ? [artist.city, artist.state].filter(Boolean).join(' · ')
    : '';
  const chips = styleChips(artist);
  const initial = (artist?.name || '?').trim().charAt(0).toUpperCase();
  const temShowHoje = publicEvents.some((item) => toCalendarYmd(item.event_date) === todayCalendarYmd());
  const publicWhatsapp =
    artist?.show_whatsapp && artist.whatsapp?.trim() ? artist.whatsapp.trim() : '';
  const publicEmail =
    artist?.show_email && artist.email?.trim() ? artist.email.trim() : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.text }]}>Perfil</Text>
        {canManagePublicProfile ? (
          <TouchableOpacity
            onPress={() => router.push('/editar-artista')}
            style={styles.iconBtn}
            hitSlop={10}
          >
            <Ionicons name="create-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        ) : canSocialWithArtists ? (
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
            {artist.cover_url || artist.profile_url ? (
              <Image
                source={{ uri: artist.cover_url || artist.profile_url }}
                style={styles.cover}
                contentFit="cover"
              />
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
            {temShowHoje ? (
              <View style={[styles.showHojeBadge, { backgroundColor: `${colors.primary}18` }]}>
                <Ionicons name="musical-notes" size={14} color={colors.primary} />
                <Text style={[styles.showHojeText, { color: colors.primary }]}>Show hoje</Text>
              </View>
            ) : null}
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
                <Text style={[styles.bioLabel, { color: colors.textSecondary }]}>
                  Experiência (não verificada pelo MeuShow)
                </Text>
                <Text style={[styles.bio, { color: colors.text }]}>{artist.bio}</Text>
              </View>
            ) : null}

            {stats ? (
              <View style={styles.statsGrid}>
                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.statNum, { color: colors.text }]}>{stats.shows_realizados}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Shows no App</Text>
                </View>
                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.statNum, { color: colors.text }]}>{stats.contratantes_atendidos}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Contratantes</Text>
                </View>
                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.statNum, { color: colors.text }]}>
                    {stats.taxa_conclusao != null ? `${stats.taxa_conclusao}%` : '—'}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Conclusão</Text>
                </View>
              </View>
            ) : null}
            {stats ? (
              <View style={{ marginTop: 10 }}>
                <ArtistReputationBadge
                  reputation={{
                    mediaNota: stats.media_nota,
                    totalAvaliacoes: stats.total_avaliacoes,
                    showsRealizados: stats.shows_realizados,
                  }}
                  onPressReviews={
                    stats.total_avaliacoes > 0 ? () => setShowReviews(true) : undefined
                  }
                />
              </View>
            ) : null}
            {presentationFormats.length ? (
              <View style={styles.bioBlock}>
                <Text style={[styles.bioLabel, { color: colors.textSecondary }]}>
                  Como se apresenta
                </Text>
                <View style={styles.formatChipsWrap}>
                  {presentationFormats.map((fmt) => (
                    <View
                      key={`fmt-${fmt}`}
                      style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    >
                      <Text style={[styles.chipText, { color: colors.text }]}>{fmt}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {isOwn && pendentes.length ? (
              <TouchableOpacity
                style={[styles.remind, { backgroundColor: `${colors.primary}14`, borderColor: colors.primary }]}
                onPress={() =>
                  router.push({ pathname: '/contratacao', params: { conviteId: pendentes[0].convite_id } })
                }
              >
                <Text style={[styles.remindText, { color: colors.primary }]}>
                  {pendentes.length === 1
                    ? `Avaliação pendente: ${pendentes[0].nome_evento}`
                    : `${pendentes.length} avaliações pendentes após shows concluídos`}
                </Text>
              </TouchableOpacity>
            ) : null}

            {publicWhatsapp || publicEmail || pressKitItems.length || previews.length ? (
              <View style={styles.socialRow}>
                {publicWhatsapp ? (
                  <TouchableOpacity
                    style={[styles.socialBtn, { borderColor: '#16A34A', backgroundColor: '#16A34A12' }]}
                    onPress={() => void openWhatsAppConversation(publicWhatsapp)}
                    accessibilityLabel="Abrir WhatsApp"
                  >
                    <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                  </TouchableOpacity>
                ) : null}
                {publicEmail ? (
                  <TouchableOpacity
                    style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    onPress={() => void Linking.openURL(`mailto:${publicEmail}`)}
                    accessibilityLabel="Enviar e-mail"
                  >
                    <Ionicons name="mail-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
                ) : null}
                {pressKitItems.length ? (
                  <TouchableOpacity
                    style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    onPress={handleOpenPressKit}
                    accessibilityLabel="Abrir press kit"
                  >
                    <Ionicons name="folder-open" size={18} color={colors.primary} />
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
            ) : null}

            {canSocialWithArtists ? (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={handleConversar}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>Conversar</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {featuredHero ? (
            <View style={[styles.section, styles.sectionPad]}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadLeft}>
                  <Ionicons name="star" size={18} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Shows em destaque</Text>
                </View>
                {canManagePublicProfile && featuredShows.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => setFeaturedMenuOpen(true)}
                    style={styles.iconBtn}
                    hitSlop={10}
                    accessibilityLabel="Mais shows em destaque"
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <FeaturedShowCard show={featuredHero} colors={colors} />
            </View>
          ) : null}

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

          {spotifyPreviews.length ? (
            <View style={[styles.section, styles.sectionPad]}>
              <View style={styles.sectionHead}>
                <Ionicons name="musical-notes" size={18} color="#1DB954" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Spotify</Text>
              </View>
              <View style={styles.videoStack}>
                {spotifyPreviews.map((item) => (
                  <SocialMediaPreviewCard key={item.url} item={item} featured />
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

      <Modal
        visible={featuredMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFeaturedMenuOpen(false)}
      >
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setFeaturedMenuOpen(false)} />
          <View style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.menuHead}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Shows em destaque</Text>
              <TouchableOpacity onPress={() => setFeaturedMenuOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {canManagePublicProfile ? (
              <Text style={[styles.menuHint, { color: colors.textSecondary }]}>
                Escolha o show que fica como destaque principal no perfil.
              </Text>
            ) : null}
            {featuredShows.map((show) => {
              const isPrincipal = show.id === featuredHero?.id;
              return (
                <TouchableOpacity
                  key={show.id}
                  style={[styles.menuItem, { borderColor: colors.border }]}
                  disabled={canManagePublicProfile ? isPrincipal || savingFeatured : true}
                  onPress={() => void handleSetFeaturedPrincipal(show)}
                  activeOpacity={canManagePublicProfile && !isPrincipal ? 0.7 : 1}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.menuItemTitle, { color: colors.text }]} numberOfLines={1}>
                      {show.name}
                    </Text>
                    <Text style={[styles.menuItemSub, { color: colors.textSecondary }]} numberOfLines={1}>
                      {formatCalendarDate(show.event_date)}
                    </Text>
                  </View>
                  {isPrincipal ? (
                    <View style={[styles.principalBadge, { backgroundColor: `${colors.primary}22` }]}>
                      <Text style={[styles.principalBadgeText, { color: colors.primary }]}>Principal</Text>
                    </View>
                  ) : canManagePublicProfile ? (
                    <Text style={[styles.menuAction, { color: colors.primary }]}>Usar como principal</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal
        visible={pressKitMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPressKitMenuOpen(false)}
      >
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setPressKitMenuOpen(false)} />
          <View style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.menuHead}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>Press kit</Text>
              <TouchableOpacity onPress={() => setPressKitMenuOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {pressKitItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.menuItem, { borderColor: colors.border }]}
                onPress={() => openPressKitItem(item)}
              >
                <Ionicons
                  name={
                    isPressKitAudio(item)
                      ? 'musical-notes'
                      : item.item_type === 'file'
                        ? 'document-attach-outline'
                        : 'link-outline'
                  }
                  size={18}
                  color={colors.primary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.menuItemTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {isPressKitAudio(item) ? 'Música' : item.item_type === 'file' ? 'Arquivo' : 'Link'}
                  </Text>
                </View>
                <Ionicons
                  name={isPressKitAudio(item) ? 'play' : 'open-outline'}
                  size={16}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <ArtistReviewsModal
        visible={showReviews}
        artistId={artistId || null}
        artistName={artist?.name || 'Artista'}
        artistImage={artist?.profile_url}
        onClose={() => setShowReviews(false)}
      />
      <PressKitAudioPlayer
        visible={!!playingPressKit}
        uri={playingPressKit?.url || null}
        title={playingPressKit?.title || ''}
        artistName={artist?.name}
        colors={colors}
        onClose={() => setPlayingPressKit(null)}
      />
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
  showHojeBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  showHojeText: { fontSize: 13, fontWeight: '800' },
  roles: { marginTop: 4, fontSize: 14 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  locText: { fontSize: 13 },
  chipsRow: { gap: 8, paddingVertical: 12 },
  formatChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
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
  socialRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  socialBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  section: { marginTop: 24, paddingLeft: 20 },
  sectionPad: { paddingRight: 20 },
  videoStack: { gap: 12 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
    paddingRight: 12,
  },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  menuSheet: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  menuHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  menuTitle: { fontSize: 16, fontWeight: '800' },
  menuHint: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  menuItemTitle: { fontSize: 15, fontWeight: '700' },
  menuItemSub: { fontSize: 12, marginTop: 2 },
  menuAction: { fontSize: 12, fontWeight: '700' },
  principalBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  principalBadgeText: { fontSize: 11, fontWeight: '800' },
  previewRow: { paddingRight: 20 },
  statsGrid: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  remind: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  remindText: { fontSize: 13, fontWeight: '700' },
});
