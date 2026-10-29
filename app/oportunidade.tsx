import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../components/OptimizedImage';
import PropostaEnviadaModal from '../components/PropostaEnviadaModal';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatCityAndRegion } from '../lib/brazilGeo';
import { formatCalendarDate, formatCalendarDateLongParts } from '../lib/dateUtils';
import { formatChatCache, openArtistChatInApp, type ShowChatContext } from '../lib/openArtistChat';
import {
  oportunidadeCompativelComPerfil,
  perfilCompatFromArtist,
} from '../lib/feedCompatibility';
import { getArtistById } from '../services/supabase/artistService';
import {
  listarVisualizacoesOportunidade,
  registrarVisualizacaoOportunidade,
  type OportunidadeVisualizacao,
} from '../services/supabase/opportunityViewsService';
import { alternarEventoFavorito, listarIdsEventosFavoritos } from '../services/supabase/eventFavoritesService';
import {
  buscarCriadorOportunidade,
  desfazerPropostaFeed,
  iniciarNegociacaoFeed,
  isErroPropostaDuplicada,
  listarFeedMarketplace,
  type CriadorOportunidade,
  type FeedAnuncio,
} from '../services/supabase/feedMarketplaceService';
import { useActiveArtist } from '../services/useActiveArtist';

function formatTime(t: string) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

function formatDayMonth(dateString: string) {
  const parts = formatCalendarDateLongParts(dateString);
  if (!parts) return formatCalendarDate(dateString);
  const monthOnly = parts.rest.replace(/\s+de\s+\d{4}\s*$/, '');
  return `${parts.day} ${monthOnly}`;
}

function formatCriadoEm(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const data = date.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hora = date.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${data} às ${hora}`;
}

function formatViewedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationLabel(start: string, end: string) {
  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    if (!Number.isFinite(h)) return null;
    return h * 60 + (Number.isFinite(m) ? m : 0);
  };
  const a = toMin(start);
  const b = toMin(end);
  if (a == null || b == null) {
    const range = [formatTime(start), formatTime(end)].filter(Boolean).join(' – ');
    return range || 'A combinar';
  }
  let diff = b - a;
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hours && mins) return `${hours}h${String(mins).padStart(2, '0')}`;
  if (hours === 1) return '1 hora';
  if (hours > 1) return `${hours} horas`;
  return `${mins} min`;
}

export default function OportunidadeScreen() {
  const { colors, isDarkMode } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { canCreateEvents, isAdmin, isVendedor } = usePermissions();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const [anuncio, setAnuncio] = useState<FeedAnuncio | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [jaCandidato, setJaCandidato] = useState(false);
  const [favorito, setFavorito] = useState(false);
  const [showPropostaEnviada, setShowPropostaEnviada] = useState(false);
  const [desfazendoProposta, setDesfazendoProposta] = useState(false);
  const [podeDesfazer, setPodeDesfazer] = useState(false);
  const [compativel, setCompativel] = useState(false);
  const [visualizacoes, setVisualizacoes] = useState<OportunidadeVisualizacao[]>([]);
  const [criador, setCriador] = useState<CriadorOportunidade | null>(null);
  const canFavorite = isAdmin || isVendedor;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventId) {
        setLoading(false);
        return;
      }
      setVisualizacoes([]);
      setCriador(null);
      const [{ anuncios, error }, favoriteIds] = await Promise.all([
        listarFeedMarketplace({
          filtro: 'todos',
          artistaAtualId: activeArtist?.id ?? null,
          eventoDetalheId: eventId,
        }),
        listarIdsEventosFavoritos(),
      ]);
      if (cancelled) return;
      if (error) {
        Alert.alert('Erro', error);
        setLoading(false);
        return;
      }
      const found = anuncios.find((item) => item.id === eventId) ?? null;
      setAnuncio(found);
      setJaCandidato(!!found?.ja_proposei);
      setPodeDesfazer(!!found?.pode_desfazer);
      setFavorito(favoriteIds.has(eventId));
      setLoading(false);
      if (!found) {
        Alert.alert('Anúncio encerrado', 'Esta oportunidade não está mais disponível.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      if (activeArtist?.id && found.artist_id !== activeArtist.id) {
        void registrarVisualizacaoOportunidade(found.id, activeArtist.id);
        const { artist } = await getArtistById(activeArtist.id);
        if (!cancelled) {
          setCompativel(
            oportunidadeCompativelComPerfil(found, perfilCompatFromArtist(artist), activeArtist.id)
          );
        }
      } else if (!cancelled) {
        setCompativel(false);
        if (isAdmin && activeArtist?.id && found.artist_id === activeArtist.id) {
          const [views, autor] = await Promise.all([
            listarVisualizacoesOportunidade(found.id),
            buscarCriadorOportunidade(found.id),
          ]);
          if (!cancelled) {
            setVisualizacoes(views.items);
            setCriador(autor);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, activeArtist?.id, isAdmin]);

  const location = useMemo(
    () => (anuncio ? formatCityAndRegion({ city: anuncio.city, state_uf: anuncio.state_uf }) : ''),
    [anuncio]
  );
  const meuAnuncio = !!activeArtist?.id && anuncio?.artist_id === activeArtist.id;
  const title = anuncio?.evento_nome?.trim() || 'Oportunidade';
  const estilo = anuncio?.musical_style?.trim() || 'A combinar';
  const formato =
    anuncio && anuncio.feed_funcoes.length
      ? anuncio.feed_funcoes.length === 2
        ? anuncio.feed_funcoes.join(' ou ')
        : anuncio.feed_funcoes.join(' · ')
      : 'A combinar';
  const cacheTxt =
    anuncio?.cache_valor != null
      ? Number(anuncio.cache_valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : null;
  const cacheLine =
    anuncio?.feed_mostrar_cache && cacheTxt ? `Até ${cacheTxt}` : 'Cachê a combinar';
  const hiringLabel = anuncio?.feed_tipo === 'disponivel' ? 'Quem publicou?' : 'Quem está contratando?';

  const showContext = useMemo((): ShowChatContext | null => {
    if (!anuncio) return null;
    return {
      nome: anuncio.evento_nome || anuncio.artist_name,
      data: formatCalendarDate(anuncio.event_date),
      horario: [formatTime(anuncio.start_time), formatTime(anuncio.end_time)].filter(Boolean).join(' – '),
      local: location,
      funcao: anuncio.feed_funcoes.filter(Boolean).join(', ') || null,
      cache: formatChatCache(anuncio.cache_valor),
    };
  }, [anuncio, location]);

  const abrirConversa = () => {
    if (!anuncio) return;
    openArtistChatInApp({
      myArtistId: activeArtist?.id,
      isAdmin,
      otherArtistId: anuncio.artist_id,
      otherArtistName: anuncio.artist_name,
      otherArtistImage: anuncio.artist_image,
      showContext,
    });
  };

  const iniciar = async () => {
    if (!anuncio) return;
    if (!activeArtist) {
      Alert.alert('Perfil de artista', 'Crie ou selecione um perfil de artista para se candidatar.', [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Criar perfil', onPress: () => router.push('/cadastro-artista') },
      ]);
      return;
    }
    if (meuAnuncio) return;
    if (!canCreateEvents) {
      Alert.alert('Sem permissão', 'Somente admin ou vendedor pode iniciar negociação.');
      return;
    }
    if (jaCandidato) {
      setShowPropostaEnviada(true);
      return;
    }
    const funcoesOferta = anuncio.feed_funcoes.map((item) => item.trim()).filter(Boolean).join(' · ');
    setSending(true);
    const result = await iniciarNegociacaoFeed({
      eventoId: anuncio.id,
      artistaInteressadoId: activeArtist.id,
      funcaoParticipacao: funcoesOferta || 'Participação',
      mensagem: 'Negociação iniciada',
      nomeEvento: anuncio.evento_nome || `Negociação · ${anuncio.artist_name}`,
      eventDate: anuncio.event_date,
      startTime: formatTime(anuncio.start_time) || '20:00',
      endTime: formatTime(anuncio.end_time) || '23:00',
      city: anuncio.city,
      stateUf: anuncio.state_uf,
    });
    setSending(false);
    if (!result.success && !isErroPropostaDuplicada(result.error)) {
      Alert.alert('Erro', result.error || 'Não foi possível enviar o interesse.');
      return;
    }
    setJaCandidato(true);
    setPodeDesfazer(true);
    setShowPropostaEnviada(true);
  };

  const toggleFavorite = async () => {
    if (!anuncio || !canFavorite || meuAnuncio) return;
    const was = favorito;
    setFavorito(!was);
    const { favorite, error } = await alternarEventoFavorito(anuncio.id, was);
    if (error) {
      setFavorito(was);
      Alert.alert('Favoritos', error);
      return;
    }
    setFavorito(favorite);
  };

  const infoCards = anuncio
    ? [
        { icon: 'calendar-outline' as const, label: 'Data', value: formatDayMonth(anuncio.event_date) },
        { icon: 'musical-notes-outline' as const, label: 'Estilo', value: estilo },
        { icon: 'time-outline' as const, label: 'Duração', value: durationLabel(anuncio.start_time, anuncio.end_time) },
        { icon: 'people-outline' as const, label: 'Formato', value: formato },
      ]
    : [];
  const cardBg = isDarkMode ? colors.surface : '#F3F4F6';
  const rows = [infoCards.slice(0, 2), infoCards.slice(2, 4)];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        {canFavorite && anuncio && !meuAnuncio ? (
          <TouchableOpacity onPress={() => void toggleFavorite()} style={styles.iconBtn} hitSlop={10}>
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
      ) : !anuncio ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>Anúncio indisponível.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            {meuAnuncio && isAdmin && criador ? (
              <View style={styles.creatorRow}>
                <View style={[styles.creatorAvatar, { backgroundColor: cardBg }]}>
                  {criador.avatar ? (
                    <OptimizedImage
                      imageUrl={criador.avatar}
                      style={styles.creatorAvatarImg}
                      fallbackText={criador.nome}
                      fallbackIconSize={10}
                      showLoadingIndicator={false}
                    />
                  ) : (
                    <Text style={[styles.creatorInitial, { color: colors.primary }]}>
                      {(criador.nome || '?').trim().charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text style={[styles.creatorName, { color: colors.textSecondary }]} numberOfLines={1}>
                  {criador.nome}
                </Text>
                <Text style={[styles.creatorWhen, { color: colors.textSecondary }]}>
                  {formatCriadoEm(criador.criadoEm)}
                </Text>
              </View>
            ) : null}
            {compativel ? (
              <View style={styles.compatBadge}>
                <Ionicons name="checkmark-circle" size={15} color="#16A34A" />
                <Text style={styles.compatBadgeText}>Compatível com você</Text>
              </View>
            ) : null}
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
              <Text style={[styles.location, { color: colors.textSecondary }]} numberOfLines={1}>
                {location ? `${location} · Presencial` : 'Presencial'}
              </Text>
            </View>
            {cacheLine ? <Text style={[styles.price, { color: colors.text }]}>{cacheLine}</Text> : null}

            <View style={styles.grid}>
              {rows.map((row, rowIndex) => (
                <View key={`row-${rowIndex}`} style={styles.gridRow}>
                  {row.map((card) => (
                    <View key={card.label} style={[styles.infoCard, { backgroundColor: cardBg }]}>
                      <Ionicons name={card.icon} size={18} color={colors.textSecondary} />
                      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{card.label}</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={2}>
                        {card.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Sobre a oportunidade</Text>
            <Text style={[styles.about, { color: colors.textSecondary }]}>
              {anuncio.description?.trim() || 'Sem descrição. Confira data, formato e fale com quem publicou.'}
            </Text>

            <Text style={[styles.sectionTitle, { color: colors.text }]}>{hiringLabel}</Text>
            <TouchableOpacity
              style={[styles.hirerRow, { backgroundColor: cardBg }]}
              onPress={() =>
                router.push({ pathname: '/perfil-artista', params: { artistId: anuncio.artist_id } })
              }
              activeOpacity={0.8}
            >
              <View style={[styles.hirerAvatar, { backgroundColor: colors.background }]}>
                {anuncio.artist_image ? (
                  <OptimizedImage
                    imageUrl={anuncio.artist_image}
                    style={styles.hirerAvatarImg}
                    fallbackText={anuncio.artist_name}
                    fallbackIconSize={16}
                    showLoadingIndicator={false}
                  />
                ) : (
                  <Text style={[styles.hirerInitial, { color: colors.primary }]}>
                    {(anuncio.artist_name || '?').trim().charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={[styles.hirerName, { color: colors.text }]} numberOfLines={1}>
                {anuncio.artist_name}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {meuAnuncio && isAdmin ? (
              <View style={styles.viewsBlock}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Quem visualizou{visualizacoes.length ? ` (${visualizacoes.length})` : ''}
                </Text>
                {visualizacoes.length === 0 ? (
                  <Text style={[styles.about, { color: colors.textSecondary }]}>
                    Ninguém abriu esta oportunidade ainda.
                  </Text>
                ) : (
                  visualizacoes.map((item) => (
                    <TouchableOpacity
                      key={item.artistId}
                      style={[styles.hirerRow, styles.viewerRow, { backgroundColor: cardBg }]}
                      onPress={() =>
                        router.push({ pathname: '/perfil-artista', params: { artistId: item.artistId } })
                      }
                      activeOpacity={0.8}
                    >
                      <View style={[styles.hirerAvatar, { backgroundColor: colors.background }]}>
                        {item.artistImage ? (
                          <OptimizedImage
                            imageUrl={item.artistImage}
                            style={styles.hirerAvatarImg}
                            fallbackText={item.artistName}
                            fallbackIconSize={16}
                            showLoadingIndicator={false}
                          />
                        ) : (
                          <Text style={[styles.hirerInitial, { color: colors.primary }]}>
                            {(item.artistName || '?').trim().charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View style={styles.viewerText}>
                        <Text style={[styles.hirerName, { color: colors.text }]} numberOfLines={1}>
                          {item.artistName}
                        </Text>
                        <Text style={[styles.viewerWhen, { color: colors.textSecondary }]}>
                          {formatViewedAt(item.viewedAt)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))
                )}
              </View>
            ) : null}
          </ScrollView>

          {!meuAnuncio ? (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={abrirConversa}
                activeOpacity={0.85}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Conversar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={() => void iniciar()}
                disabled={sending}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {jaCandidato ? 'Já enviei interesse' : 'Tenho interesse'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.ownHint, { color: colors.textSecondary }]}>Este é o seu anúncio.</Text>
            </View>
          )}
        </>
      )}

      <PropostaEnviadaModal
        visible={showPropostaEnviada}
        isDemanda={anuncio?.feed_tipo === 'demanda'}
        podeDesfazer={podeDesfazer}
        desfazendo={desfazendoProposta}
        onClose={() => setShowPropostaEnviada(false)}
        onVerConvites={() => {
          setShowPropostaEnviada(false);
          router.push('/convites-participacao-evento');
        }}
        onDesfazer={() => {
          if (!anuncio || !activeArtist?.id || desfazendoProposta) return;
          void (async () => {
            setDesfazendoProposta(true);
            const { success, error: err } = await desfazerPropostaFeed({
              eventoId: anuncio.id,
              artistaInteressadoId: activeArtist.id,
            });
            setDesfazendoProposta(false);
            if (!success) {
              Alert.alert('Desfazer', err || 'Não foi possível desfazer a proposta.');
              return;
            }
            setShowPropostaEnviada(false);
            setJaCandidato(false);
            setPodeDesfazer(false);
          })();
        }}
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
    minHeight: 44,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  creatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarImg: { width: 22, height: 22 },
  creatorInitial: { fontSize: 11, fontWeight: '800' },
  creatorName: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  creatorWhen: { fontSize: 12 },
  compatBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  compatBadgeText: {
    color: '#16A34A',
    fontSize: 13,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  location: { flex: 1, fontSize: 14 },
  price: {
    marginTop: 18,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  grid: {
    marginTop: 18,
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  infoCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 108,
  },
  infoLabel: { marginTop: 10, fontSize: 13 },
  infoValue: { marginTop: 4, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 24, marginBottom: 20 },
  sectionTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  about: { fontSize: 16, lineHeight: 24, marginBottom: 24 },
  hirerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hirerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hirerAvatarImg: { width: 44, height: 44 },
  hirerInitial: { fontSize: 16, fontWeight: '800' },
  hirerName: { flex: 1, fontSize: 16, fontWeight: '700' },
  viewsBlock: { marginTop: 24, gap: 8 },
  viewerRow: { marginTop: 0 },
  viewerText: { flex: 1 },
  viewerWhen: { marginTop: 2, fontSize: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700' },
  primaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ownHint: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '600' },
});
