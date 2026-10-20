import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../../components/OptimizedImage';
import ArtistReputationBadge from '../../components/ArtistReputationBadge';
import ArtistReviewsModal from '../../components/ArtistReviewsModal';
import PermissionModal from '../../components/PermissionModal';
import FeedComoFuncionaModal from '../../components/FeedComoFuncionaModal';
import PropostaEnviadaModal from '../../components/PropostaEnviadaModal';
import BrazilStatePickerModal from '../../components/BrazilStatePickerModal';
import BrazilPlaceSearchField from '../../components/BrazilPlaceSearchField';
import FeedFuncaoPickerModal, { FeedFuncaoFieldButton } from '../../components/FeedFuncaoPickerModal';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useActiveArtistContext } from '../../contexts/ActiveArtistContext';
import { useTheme } from '../../contexts/ThemeContext';
import { formatEventLocationSlash } from '../../lib/brazilGeo';
import { formatCalendarDate, formatCalendarDateLongParts, weekdayFromCalendarDate } from '../../lib/dateUtils';
import {
  ARTIST_WORK_ROLE_PRESETS,
} from '../../constants/artistProfileLists';
import { supabase } from '../../lib/supabase';
import {
  desfazerPropostaFeed,
  encerrarAnuncioFeed,
  listarFeedMarketplace,
  listarPropostasFeedMarketplace,
  type FeedAnuncio,
  type FeedFiltro,
  type FeedProposta,
} from '../../services/supabase/feedMarketplaceService';
import { aceitarConviteParticipacao } from '../../services/supabase/conviteParticipacaoEventoService';

function formatTime(t: string) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

const FEED_COMO_FUNCIONA_SEEN_KEY = 'feed_marketplace_como_funciona_visto';

const FILTROS: { id: FeedFiltro; label: string; descricao: string }[] = [
  { id: 'todos', label: 'Todos', descricao: 'Todas as publicações' },
  {
    id: 'disponivel',
    label: 'Ofertas',
    descricao: 'Quem está oferecendo artista, banda, músico, serviço, parceria etc.',
  },
  {
    id: 'demanda',
    label: 'Procurando',
    descricao: 'Quem está buscando artista, músico, banda, serviço, parceria etc.',
  },
];

export default function FeedScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const { canCreateEvents } = usePermissions();
  const [filtro, setFiltro] = useState<FeedFiltro>('todos');
  const [verMinhas, setVerMinhas] = useState(false);
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [estadoUf, setEstadoUf] = useState('');
  const [cidade, setCidade] = useState('');
  const [showEstados, setShowEstados] = useState(false);
  const [showFuncaoPicker, setShowFuncaoPicker] = useState(false);
  const [anuncios, setAnuncios] = useState<FeedAnuncio[]>([]);
  const [propostasPorEvento, setPropostasPorEvento] = useState<Record<string, FeedProposta[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showPublicarOpcoes, setShowPublicarOpcoes] = useState(false);
  const [showPropostaEnviada, setShowPropostaEnviada] = useState(false);
  const [anuncioProposta, setAnuncioProposta] = useState<FeedAnuncio | null>(null);
  const [desfazendoProposta, setDesfazendoProposta] = useState(false);
  const [reviewsArtist, setReviewsArtist] = useState<{
    id: string;
    name: string;
    image: string | null;
  } | null>(null);
  const [anuncioMenu, setAnuncioMenu] = useState<FeedAnuncio | null>(null);
  const [aceitandoConviteId, setAceitandoConviteId] = useState<string | null>(null);
  const [showComoFunciona, setShowComoFunciona] = useState(false);

  const loadGenerationRef = useRef(0);

  const funcaoFilterOptions = useMemo(
    () => [...ARTIST_WORK_ROLE_PRESETS],
    []
  );

  const load = useCallback(async (silent = false) => {
    const generation = ++loadGenerationRef.current;
    if (!silent) {
      setLoading(true);
    }
    const artistId = activeArtist?.id ?? null;
    const marketplaceRes = await listarFeedMarketplace({
      filtro: verMinhas ? 'meus' : filtro,
      estadoUf: verMinhas ? '' : estadoUf,
      cidade: verMinhas ? '' : cidade,
      funcao: verMinhas ? '' : filtroFuncao,
      artistaAtualId: artistId,
    });

    if (generation !== loadGenerationRef.current) return;

    const visiveis =
      !marketplaceRes.error && verMinhas && artistId
        ? marketplaceRes.anuncios.filter((item) => item.artist_id === artistId)
        : !marketplaceRes.error
          ? marketplaceRes.anuncios
          : [];

    setAnuncios(visiveis);
    setError(visiveis.length === 0 ? marketplaceRes.error : marketplaceRes.error);
    setLoading(false);
    setRefreshing(false);

    if (artistId) {
      void (async () => {
        const { propostas } = await listarPropostasFeedMarketplace(artistId);
        if (generation !== loadGenerationRef.current) return;

        const meusIds = new Set(
          visiveis.filter((item) => item.artist_id === artistId).map((item) => item.id)
        );
        const grouped: Record<string, FeedProposta[]> = {};
        propostas.forEach((proposta) => {
          if (!meusIds.has(proposta.evento_id)) return;
          if (!grouped[proposta.evento_id]) grouped[proposta.evento_id] = [];
          grouped[proposta.evento_id].push(proposta);
        });
        setPropostasPorEvento(grouped);
      })();
    } else {
      setPropostasPorEvento({});
    }
  }, [filtro, verMinhas, estadoUf, cidade, filtroFuncao, activeArtist?.id]);

  const skipNextFocusLoadRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void AsyncStorage.getItem(FEED_COMO_FUNCIONA_SEEN_KEY).then((value) => {
      if (cancelled || value === '1') return;
      timer = setTimeout(() => {
        if (!cancelled) setShowComoFunciona(true);
      }, 350);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const fecharComoFunciona = useCallback(() => {
    setShowComoFunciona(false);
    void AsyncStorage.setItem(FEED_COMO_FUNCIONA_SEEN_KEY, '1');
  }, []);

  useEffect(() => {
    setAnuncios([]);
    setPropostasPorEvento({});
    skipNextFocusLoadRef.current = true;
  }, [activeArtist?.id]);

  useEffect(() => {
    if (!activeArtist?.id) return;
    void load(false);
  }, [filtro, verMinhas, filtroFuncao, activeArtist?.id, load]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusLoadRef.current) {
        skipNextFocusLoadRef.current = false;
        return;
      }
      void load(true);
    }, [load])
  );

  const emptyCopy = useMemo(() => {
    if (filtroFuncao) {
      return `Nenhuma publicação com a função "${filtroFuncao}" neste filtro.`;
    }
    if (filtro === 'disponivel') {
      return 'Nenhuma oferta neste filtro.';
    }
    if (filtro === 'demanda') {
      return 'Ninguém está procurando neste filtro.';
    }
    if (verMinhas) {
      return 'Você ainda não publicou no feed.';
    }
    return 'Ainda não há publicações no feed.';
  }, [filtro, verMinhas, filtroFuncao]);

  const handlePublicar = () => {
    if (!activeArtist) {
      Alert.alert(
        'Perfil de artista',
        'Crie ou selecione um perfil de artista para publicar no feed.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Criar perfil', onPress: () => router.push('/cadastro-artista') },
        ],
      );
      return;
    }
    setShowPublicarOpcoes(true);
  };

  const handleEscolherPublicacao = (tipo: 'disponivel' | 'demanda') => {
    if (!canCreateEvents) {
      setShowPublicarOpcoes(false);
      setShowPermissionModal(true);
      return;
    }
    setShowPublicarOpcoes(false);
    router.push({ pathname: '/publicar-feed', params: { tipo } });
  };

  const isMeuAnuncio = (item: FeedAnuncio) =>
    !!activeArtist?.id && item.artist_id === activeArtist.id;

  const handleNegociar = (item: FeedAnuncio) => {
    if (isMeuAnuncio(item)) {
      Alert.alert('Seu anúncio', 'Você não pode iniciar negociação na sua própria publicação.');
      return;
    }
    if (item.ja_proposei) {
      setAnuncioProposta(item);
      setShowPropostaEnviada(true);
      return;
    }
    if (!activeArtist) {
      Alert.alert(
        'Perfil de artista',
        'Crie ou selecione um perfil de artista para negociar no feed.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Criar perfil', onPress: () => router.push('/cadastro-artista') },
        ],
      );
      return;
    }
    if (!canCreateEvents) {
      setShowPermissionModal(true);
      return;
    }
    router.push({ pathname: '/negociar-feed', params: { eventId: item.id } });
  };

  const nomeDespesaProposta = (proposta: FeedProposta) => {
    const funcao =
      proposta.funcao && proposta.funcao.trim().toLowerCase() !== 'interesse'
        ? proposta.funcao.trim()
        : null;
    return funcao ? `${proposta.artista_nome} - ${funcao}` : proposta.artista_nome;
  };

  const aceitarPropostaFeed = async (_item: FeedAnuncio, proposta: FeedProposta) => {
    if (!activeArtist?.id || aceitandoConviteId) return;
    setAceitandoConviteId(proposta.convite_id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { success, error: err } = await aceitarConviteParticipacao(
      proposta.convite_id,
      user?.id ?? '',
      proposta.artista_id
    );
    setAceitandoConviteId(null);
    if (!success) {
      Alert.alert('Não foi possível aceitar', err || 'Tente novamente.');
      return;
    }
    void load();
    Alert.alert(
      'Aceito',
      `Despesa lançada: ${nomeDespesaProposta(proposta)}. O evento entrou na agenda dos dois artistas.`
    );
  };

  const handlePropostaPress = (item: FeedAnuncio, proposta: FeedProposta) => {
    if (proposta.status === 'aceito') {
      Alert.alert('Proposta aceita', 'Este artista já está na agenda deste evento.');
      return;
    }
    if (item.feed_tipo === 'demanda') {
      Alert.alert(
        'Aceitar candidato',
        `Confirmar ${proposta.artista_nome} neste evento?\n\nO cachê entra como despesa: ${nomeDespesaProposta(proposta)}.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Aceitar',
            onPress: () => void aceitarPropostaFeed(item, proposta),
          },
        ]
      );
      return;
    }
    router.push('/convites-participacao-evento');
  };

  const handleEditar = (item: FeedAnuncio) => {
    if (item.propostas_count > 0) {
      Alert.alert(
        'Não é possível editar',
        'Este anúncio já tem candidatos. Para mudar a data ou outros dados, encerre e publique novamente.'
      );
      return;
    }
    router.push({
      pathname: '/publicar-feed',
      params: { eventId: item.id, tipo: item.feed_tipo },
    });
  };

  const handleEncerrar = (item: FeedAnuncio) => {
    const temCandidatos = item.propostas_count > 0;
    Alert.alert(
      'Encerrar anúncio',
      temCandidatos
        ? 'Ele sai do feed e as candidaturas pendentes são canceladas. Quem já foi aceito permanece na agenda. O financeiro não é alterado.'
        : 'Ele sai do feed. A agenda e o financeiro não são alterados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Encerrar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const { success, error: err } = await encerrarAnuncioFeed(item.id);
              if (!success) {
                Alert.alert('Erro', err || 'Não foi possível encerrar.');
                return;
              }
              void load();
            })();
          },
        },
      ]
    );
  };

  const renderMarketplaceItem = (item: FeedAnuncio) => {
    const meuAnuncio = isMeuAnuncio(item);
    const isDemanda = item.feed_tipo === 'demanda';
    const badgeColor = isDemanda ? '#4F46E5' : '#0F766E';
    const location = formatEventLocationSlash({
      city: item.city,
      state_uf: item.state_uf,
    });
    const weekday = weekdayFromCalendarDate(item.event_date);
    const dateParts = formatCalendarDateLongParts(item.event_date);
    const cacheTxt =
      item.cache_valor != null
        ? Number(item.cache_valor).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })
        : null;
    const cacheDisplay = item.feed_mostrar_cache
      ? cacheTxt
      : meuAnuncio
        ? 'oculto no feed'
        : null;
    const propostas = meuAnuncio ? propostasPorEvento[item.id] || [] : [];
    const avatarUrls = meuAnuncio
      ? (
          item.propostas_avatars.length
            ? item.propostas_avatars
            : propostas.map((proposta) => proposta.artista_image).filter((url): url is string => !!url)
        ).slice(0, 3)
      : [];
    const timeLabel = item.start_time
      ? `${formatTime(item.start_time)} – ${formatTime(item.end_time)}`
      : 'A combinar';
    const artistDisplayName = meuAnuncio
      ? activeArtist?.name || item.artist_name
      : item.artist_name;
    const artistLabel = meuAnuncio ? 'Você' : item.artist_name;
    const artistAvatarUrl = item.artist_image?.trim() || '';
    const artistInitial = artistDisplayName.trim().charAt(0).toUpperCase() || '?';
    const tipoLabel = isDemanda ? 'Procurando' : 'Oferecendo';
    const funcoesTxt = item.feed_funcoes.length > 0 ? item.feed_funcoes.join(' · ') : '';
    const offerLine = isDemanda
      ? funcoesTxt
        ? `Procura ${funcoesTxt}`
        : 'Procura artista, músico ou serviço'
      : funcoesTxt
        ? `Oferece ${funcoesTxt}`
        : 'Oferece disponibilidade nesta data';

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={[styles.typeBanner, { backgroundColor: badgeColor }]}>
          <View style={styles.typeBannerLeft}>
            <Ionicons
              name={isDemanda ? 'search-outline' : 'megaphone-outline'}
              size={15}
              color="#fff"
            />
            <Text style={styles.typeBannerText}>{tipoLabel}</Text>
          </View>
          <View style={styles.moreBtn}>
            {meuAnuncio ? (
              <TouchableOpacity
                onPress={() => setAnuncioMenu(item)}
                hitSlop={10}
                accessibilityLabel="Mais opções"
              >
                <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/perfil-artista', params: { artistId: item.artist_id } })
              }
              activeOpacity={0.8}
              style={[styles.cardAvatar, { backgroundColor: colors.background, borderColor: colors.border }]}
            >
              {artistAvatarUrl ? (
                <OptimizedImage
                  imageUrl={artistAvatarUrl}
                  style={styles.cardAvatarImg}
                  fallbackText={artistInitial}
                  fallbackIconSize={16}
                  showLoadingIndicator={false}
                />
              ) : (
                <Text style={[styles.cardAvatarInitial, { color: colors.primary }]}>{artistInitial}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.cardDateCol}>
              {weekday ? (
                <Text style={[styles.cardWeekday, { color: badgeColor }]}>{weekday}</Text>
              ) : null}
              {dateParts ? (
                <View style={styles.cardDateHero}>
                  <Text style={[styles.cardDayNumber, { color: colors.text }]}>{dateParts.day}</Text>
                  <Text style={[styles.cardDateRest, { color: colors.text }]}>{dateParts.rest}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                onPress={() =>
                  router.push({ pathname: '/perfil-artista', params: { artistId: item.artist_id } })
                }
                activeOpacity={0.75}
              >
                <Text style={[styles.cardArtistName, { color: colors.text }]} numberOfLines={1}>
                  {artistLabel}
                </Text>
              </TouchableOpacity>
              {!meuAnuncio ? (
                <ArtistReputationBadge
                  compact
                  reputation={{
                    mediaNota: item.artist_media_nota,
                    totalAvaliacoes: item.artist_total_avaliacoes,
                    showsRealizados: item.artist_shows_realizados,
                  }}
                  onPressReviews={
                    item.artist_total_avaliacoes > 0
                      ? () =>
                          setReviewsArtist({
                            id: item.artist_id,
                            name: item.artist_name,
                            image: item.artist_image,
                          })
                      : undefined
                  }
                />
              ) : null}
            </View>
          </View>

          {item.evento_nome ? (
            <Text style={[styles.cardEventName, { color: colors.text }]} numberOfLines={2}>
              {item.evento_nome}
            </Text>
          ) : null}

          {item.feed_funcoes.length > 0 ? (
            <View style={styles.cardTagsWrap}>
              {item.feed_funcoes.map((funcao) => (
                <View
                  key={funcao}
                  style={[
                    styles.cardTag,
                    {
                      backgroundColor: `${badgeColor}14`,
                      borderColor: `${badgeColor}33`,
                    },
                  ]}
                >
                  <Text style={[styles.cardTagText, { color: badgeColor }]}>{funcao}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.cardOfferLine, { color: colors.text }]} numberOfLines={2}>
              {offerLine}
            </Text>
          )}

          <View style={styles.cardMetaRow}>
            <View style={styles.cardMetaItem}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.cardMetaText, { color: colors.textSecondary }]}>{timeLabel}</Text>
            </View>
            {location ? (
              <View style={styles.cardMetaItem}>
                <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.cardMetaText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {location}
                </Text>
              </View>
            ) : null}
          </View>

          {cacheDisplay ? (
            <View style={[styles.cachePill, { backgroundColor: `${colors.primary}10` }]}>
              <Ionicons name="cash-outline" size={14} color={colors.primary} />
              <Text style={[styles.cachePillText, { color: colors.text }]}>Cachê {cacheDisplay}</Text>
            </View>
          ) : null}

          {item.description ? (
            <Text style={[styles.notes, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          {item.propostas_count > 0 || meuAnuncio ? (
          <View style={styles.propostasResumo}>
            {meuAnuncio ? (
            <View style={styles.avatarStack}>
              {avatarUrls.length
                ? avatarUrls.map((url, index) => (
                    <View
                      key={`${url}-${index}`}
                      style={[
                        styles.stackAvatar,
                        {
                          marginLeft: index === 0 ? 0 : -6,
                          zIndex: 10 - index,
                          backgroundColor: colors.secondary,
                          borderColor: colors.surface,
                        },
                      ]}
                    >
                      <OptimizedImage
                        imageUrl={url}
                        style={styles.stackAvatarImg}
                        fallbackIcon="person"
                        fallbackIconSize={9}
                      />
                    </View>
                  ))
                : item.propostas_count > 0
                  ? Array.from({ length: Math.min(item.propostas_count, 3) }).map((_, index) => (
                      <View
                        key={`ph-${index}`}
                        style={[
                          styles.stackAvatar,
                          {
                            marginLeft: index === 0 ? 0 : -6,
                            zIndex: 10 - index,
                            backgroundColor: colors.secondary,
                            borderColor: colors.surface,
                          },
                        ]}
                      >
                        <Ionicons name="person" size={9} color={colors.primary} />
                      </View>
                    ))
                  : null}
            </View>
            ) : null}
            <Text style={[styles.countPillText, { color: colors.textSecondary }]}>
              {meuAnuncio
                ? item.propostas_count === 0
                  ? 'Nenhuma proposta'
                  : item.propostas_count === 1
                    ? '1 proposta'
                    : `${item.propostas_count} propostas`
                : item.propostas_count === 1
                  ? '1 pessoa se candidatou'
                  : `${item.propostas_count} pessoas se candidataram`}
            </Text>
          </View>
        ) : null}

        {meuAnuncio && propostas.length > 0 ? (
          <View style={[styles.propostasBox, { borderColor: colors.border }]}>
            {propostas.map((proposta) => (
              <TouchableOpacity
                key={proposta.convite_id}
                style={styles.propostaRow}
                onPress={() => handlePropostaPress(item, proposta)}
                activeOpacity={0.8}
                disabled={aceitandoConviteId === proposta.convite_id}
              >
                <View style={[styles.propostaAvatar, { backgroundColor: colors.secondary }]}>
                  {proposta.artista_image ? (
                    <OptimizedImage
                      imageUrl={proposta.artista_image}
                      style={styles.propostaAvatarImg}
                      fallbackIcon="person"
                      fallbackIconSize={14}
                    />
                  ) : (
                    <Ionicons name="person" size={14} color={colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.propostaNome, { color: colors.text }]} numberOfLines={1}>
                    {proposta.artista_nome}
                  </Text>
                  <Text style={[styles.propostaMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {proposta.status === 'aceito'
                      ? 'Aceita'
                      : isDemanda
                        ? 'Pendente · toque para aceitar'
                        : 'Pendente · toque para aceitar o convite'}
                    {proposta.funcao && proposta.funcao !== 'Interesse'
                      ? ` · ${proposta.funcao}`
                      : ''}
                  </Text>
                </View>
                {aceitandoConviteId === proposta.convite_id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name={proposta.status === 'aceito' ? 'checkmark-circle' : 'chevron-forward'}
                    size={14}
                    color={proposta.status === 'aceito' ? colors.primary : colors.textSecondary}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {!meuAnuncio ? (
          <TouchableOpacity
            style={
              item.ja_proposei
                ? [styles.btnOutline, { borderColor: colors.primary }]
                : [styles.btnPrimary, { backgroundColor: colors.primary }]
            }
            onPress={() => handleNegociar(item)}
          >
            <Text
              style={
                item.ja_proposei
                  ? [styles.btnOutlineText, { color: colors.primary }]
                  : styles.btnPrimaryText
              }
            >
              {item.ja_proposei
                ? 'Proposta enviada'
                : isDemanda
                  ? 'Candidatar'
                  : 'Tenho interesse'}
            </Text>
          </TouchableOpacity>
        ) : null}
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: FeedAnuncio }) => renderMarketplaceItem(item);

  const artistAvatarUrl = activeArtist?.profile_url?.trim() || '';
  const artistInitial = activeArtist?.name?.trim().charAt(0).toUpperCase() || '?';

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Feed' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityLabel="Voltar"
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.titleLeft}>
            <Text style={[styles.title, { color: colors.text }]}>Feed</Text>
            <View style={[styles.betaBadge, { backgroundColor: `${colors.primary}18` }]}>
              <Text style={[styles.betaBadgeText, { color: colors.primary }]}>Beta</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => setShowComoFunciona(true)}
            hitSlop={10}
            style={styles.helpBtn}
            accessibilityLabel="Como funciona o Feed"
            accessibilityRole="button"
          >
            <Ionicons name="help-circle-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {[{ id: 'perfil' as const, label: 'Perfil' }, ...FILTROS].map((item) => {
            const active = item.id === 'perfil' ? verMinhas : !verMinhas && filtro === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.chip,
                  item.id === 'perfil' && styles.chipPerfil,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  if (item.id === 'perfil') {
                    setVerMinhas(true);
                    return;
                  }
                  setVerMinhas(false);
                  setFiltro(item.id);
                }}
              >
                {item.id === 'perfil' ? (
                  <View
                    style={[
                      styles.chipAvatarWrap,
                      {
                        borderColor: active ? '#fff' : colors.border,
                        backgroundColor: active ? 'rgba(255,255,255,0.18)' : colors.secondary,
                      },
                    ]}
                  >
                    {artistAvatarUrl ? (
                      <Image
                        key={`${activeArtist?.id ?? 'sem-artista'}-${artistAvatarUrl}`}
                        source={{ uri: artistAvatarUrl }}
                        style={styles.chipAvatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={styles.chipAvatarFallback}>
                        {activeArtist ? (
                          <Text
                            style={[
                              styles.chipAvatarInitial,
                              { color: active ? '#fff' : colors.primary },
                            ]}
                          >
                            {artistInitial}
                          </Text>
                        ) : (
                          <Ionicons
                            name="person"
                            size={12}
                            color={active ? '#fff' : colors.textSecondary}
                          />
                        )}
                      </View>
                    )}
                  </View>
                ) : null}
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {!verMinhas ? (
          <>
            <View style={styles.geoRow}>
              <TouchableOpacity
                style={[
                  styles.geoField,
                  styles.geoUf,
                  {
                    backgroundColor: colors.surface,
                    borderColor: estadoUf ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setShowEstados(true)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.geoFieldText, { color: estadoUf ? colors.text : colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {estadoUf || 'UF'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <View
                style={[
                  styles.geoField,
                  styles.geoCity,
                  {
                    backgroundColor: colors.surface,
                    borderColor: cidade.trim() ? colors.primary : colors.border,
                  },
                ]}
              >
                <BrazilPlaceSearchField
                  compact
                  value={cidade}
                  onChangeText={setCidade}
                  onSelectPlace={(place) => {
                    setCidade(place.city);
                    if (place.uf) setEstadoUf(place.uf);
                  }}
                  placeholder="Cidade"
                />
              </View>
            </View>
            <View style={styles.funcaoRow}>
              <FeedFuncaoFieldButton
                selectedFuncao={filtroFuncao}
                onPress={() => setShowFuncaoPicker(true)}
                colors={colors}
              />
            </View>
          </>
        ) : null}
      </View>

      {error ? (
        <TouchableOpacity
          style={[styles.errorBanner, { backgroundColor: `${colors.primary}12` }]}
          onPress={() => void load()}
          activeOpacity={0.85}
        >
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={[styles.errorBannerText, { color: colors.text }]} numberOfLines={2}>
            Não deu para atualizar. Toque para tentar de novo.
          </Text>
        </TouchableOpacity>
      ) : null}

      {!activeArtist ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={42} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Crie um perfil de artista</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            O feed precisa de um perfil ativo para publicar e negociar.
          </Text>
          <TouchableOpacity
            style={[styles.emptyCta, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/cadastro-artista')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyCtaText}>Criar perfil</Text>
          </TouchableOpacity>
        </View>
      ) : loading && anuncios.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          key={activeArtist?.id ?? 'sem-artista'}
          data={anuncios}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={5}
          maxToRenderPerBatch={4}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={anuncios.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="newspaper-outline" size={42} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {error ? 'Nada por aqui agora' : 'Feed vazio'}
              </Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {error ? 'Puxe para atualizar ou toque no aviso acima.' : emptyCopy}
              </Text>
            </View>
          }
        />
      )}

      {activeArtist ? (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handlePublicar}
          accessibilityLabel="Publicar no feed"
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <BrazilStatePickerModal
        visible={showEstados}
        onClose={() => setShowEstados(false)}
        selectedUf={estadoUf}
        onSelect={(uf) => setEstadoUf(uf || '')}
      />
      <FeedFuncaoPickerModal
        visible={showFuncaoPicker}
        onClose={() => setShowFuncaoPicker(false)}
        options={funcaoFilterOptions}
        selectedFuncao={filtroFuncao}
        onSelect={setFiltroFuncao}
      />
      <ArtistReviewsModal
        visible={!!reviewsArtist}
        artistId={reviewsArtist?.id ?? null}
        artistName={reviewsArtist?.name ?? 'Artista'}
        artistImage={reviewsArtist?.image}
        onClose={() => setReviewsArtist(null)}
      />
      <FeedComoFuncionaModal visible={showComoFunciona} onClose={fecharComoFunciona} />
      <PermissionModal
        visible={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        title="Sem permissão"
        message="Somente admin ou vendedor pode publicar e iniciar negociação no feed."
      />
      <PropostaEnviadaModal
        visible={showPropostaEnviada}
        isDemanda={anuncioProposta?.feed_tipo === 'demanda'}
        podeDesfazer={!!anuncioProposta?.pode_desfazer}
        desfazendo={desfazendoProposta}
        onClose={() => {
          setShowPropostaEnviada(false);
          setAnuncioProposta(null);
        }}
        onVerConvites={() => {
          setShowPropostaEnviada(false);
          setAnuncioProposta(null);
          router.push('/convites-participacao-evento');
        }}
        onDesfazer={() => {
          if (!anuncioProposta || !activeArtist?.id || desfazendoProposta) return;
          void (async () => {
            setDesfazendoProposta(true);
            const { success, error: err } = await desfazerPropostaFeed({
              eventoId: anuncioProposta.id,
              artistaInteressadoId: activeArtist.id,
            });
            setDesfazendoProposta(false);
            if (!success) {
              Alert.alert('Desfazer', err || 'Não foi possível desfazer a proposta.');
              return;
            }
            setShowPropostaEnviada(false);
            setAnuncioProposta(null);
            void load();
          })();
        }}
      />
      <Modal
        visible={showPublicarOpcoes}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPublicarOpcoes(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowPublicarOpcoes(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Publicar no feed</Text>
            <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>
              Escolha o tipo de publicação de show
            </Text>

            <TouchableOpacity
              style={[styles.optionCard, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => handleEscolherPublicacao('disponivel')}
              activeOpacity={0.85}
            >
              <View style={[styles.optionIcon, { backgroundColor: '#0F766E18' }]}>
                <Ionicons name="briefcase-outline" size={22} color="#0F766E" />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>Oferecer</Text>
                <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
                  Oferecendo artista, banda, músico, serviço, parceria etc.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionCard, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => handleEscolherPublicacao('demanda')}
              activeOpacity={0.85}
            >
              <View style={[styles.optionIcon, { backgroundColor: '#4F46E518' }]}>
                <Ionicons name="search" size={22} color="#4F46E5" />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>Procurar</Text>
                <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
                  Buscando artista, músico, banda, serviço, parceria etc.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowPublicarOpcoes(false)}>
              <Text style={[styles.sheetCancelText, { color: colors.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!anuncioMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setAnuncioMenu(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setAnuncioMenu(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            {anuncioMenu ? (
              <View
                style={[
                  styles.menuSummary,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.menuSummaryTipo,
                    { color: anuncioMenu.feed_tipo === 'demanda' ? '#4F46E5' : '#0F766E' },
                  ]}
                >
                  {anuncioMenu.feed_tipo === 'demanda' ? 'Procurando' : 'Oferecendo'}
                </Text>
                <Text style={[styles.menuSummaryDate, { color: colors.text }]}>
                  {[
                    weekdayFromCalendarDate(anuncioMenu.event_date),
                    formatCalendarDate(anuncioMenu.event_date),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {anuncioMenu.evento_nome ? (
                  <Text style={[styles.menuSummaryFuncoes, { color: colors.text }]} numberOfLines={2}>
                    {anuncioMenu.evento_nome}
                  </Text>
                ) : null}
                <Text style={[styles.menuSummaryFuncoes, { color: colors.textSecondary }]} numberOfLines={1}>
                  {anuncioMenu.feed_funcoes.length > 0
                    ? anuncioMenu.feed_funcoes.join(' · ')
                    : anuncioMenu.feed_tipo === 'demanda'
                      ? 'Artista, músico ou serviço'
                      : 'Disponibilidade nesta data'}
                </Text>
              </View>
            ) : null}

            <View style={[styles.menuGroup, { borderColor: colors.border }]}>
              {anuncioMenu && anuncioMenu.propostas_count > 0 ? (
                <View style={styles.menuRow}>
                  <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.menuRowText, { color: colors.textSecondary }]}>
                    Não é possível editar com candidatos
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    if (!anuncioMenu) return;
                    const item = anuncioMenu;
                    setAnuncioMenu(null);
                    handleEditar(item);
                  }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="create-outline" size={20} color={colors.text} />
                  <Text style={[styles.menuRowText, { color: colors.text }]}>Editar anúncio</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}

              {anuncioMenu && anuncioMenu.propostas_count > 0 ? (
                <>
                  <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      setAnuncioMenu(null);
                      router.push('/convites-participacao-evento');
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="people-outline" size={20} color={colors.text} />
                    <Text style={[styles.menuRowText, { color: colors.text }]}>
                      {anuncioMenu.propostas_count === 1
                        ? 'Ver 1 proposta'
                        : `Ver ${anuncioMenu.propostas_count} propostas`}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            <View style={[styles.menuGroup, { borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => {
                  if (!anuncioMenu) return;
                  const item = anuncioMenu;
                  setAnuncioMenu(null);
                  handleEncerrar(item);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="close-circle-outline" size={20} color="#DC2626" />
                <Text style={[styles.menuRowText, { color: '#DC2626' }]}>Encerrar anúncio</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.sheetCancel} onPress={() => setAnuncioMenu(null)}>
              <Text style={[styles.sheetCancelText, { color: colors.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingTop: 8, paddingBottom: 10 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 10,
    gap: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 26, fontWeight: '800' },
  betaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  betaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  helpBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  chipPerfil: {
    paddingLeft: 6,
    gap: 6,
  },
  chipAvatarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  chipAvatar: {
    width: '100%',
    height: '100%',
  },
  chipAvatarFallback: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarInitial: {
    fontSize: 11,
    fontWeight: '800',
  },
  geoRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  geoField: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  geoUf: { width: 78 },
  geoCity: { flex: 1 },
  geoFieldText: { flex: 1, fontSize: 14, fontWeight: '700' },
  geoInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 0,
    minWidth: 0,
  },
  funcaoRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorBannerText: { flex: 1, fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 96 },
  emptyList: { flexGrow: 1, padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyCta: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  typeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
  },
  typeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  typeBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  moreBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  cardWeekday: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardDateHero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 1,
  },
  cardDayNumber: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.6,
  },
  cardDateRest: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    flexShrink: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardDateCol: {
    flex: 1,
    minWidth: 0,
  },
  cardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  cardAvatarInitial: {
    fontSize: 15,
    fontWeight: '800',
  },
  cardOfferLine: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  cardEventName: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  cardTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cardTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  cardMetaText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  cachePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cachePillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  notes: { fontSize: 13, lineHeight: 18 },
  cardArtistName: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  propostasResumo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  stackAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stackAvatarImg: { width: 18, height: 18, borderRadius: 9 },
  countPillText: { fontSize: 11, fontWeight: '600' },
  propostasBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    gap: 8,
  },
  propostaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  propostaAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  propostaAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  propostaNome: { fontSize: 13, fontWeight: '700' },
  propostaMeta: { fontSize: 11, marginTop: 1 },
  btnPrimary: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnOutline: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  btnOutlineText: { fontWeight: '800', fontSize: 13 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800' },
  sheetSub: { fontSize: 14, marginTop: 4, marginBottom: 16 },
  menuSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 2,
  },
  menuSummaryTipo: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  menuSummaryDate: {
    fontSize: 16,
    fontWeight: '800',
  },
  menuSummaryFuncoes: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  menuGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuRowText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCopy: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '800' },
  optionDesc: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  sheetCancel: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  sheetCancelText: { fontSize: 15, fontWeight: '700' },
});
