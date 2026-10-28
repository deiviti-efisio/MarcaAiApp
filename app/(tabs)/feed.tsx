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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OptimizedImage from '../../components/OptimizedImage';
import ArtistReputationBadge from '../../components/ArtistReputationBadge';
import ArtistReviewsModal from '../../components/ArtistReviewsModal';
import PermissionModal from '../../components/PermissionModal';
import FeedComoFuncionaModal from '../../components/FeedComoFuncionaModal';
import PropostaEnviadaModal from '../../components/PropostaEnviadaModal';
import ParceriaFeitaModal from '../../components/ParceriaFeitaModal';
import BrazilStatePickerModal from '../../components/BrazilStatePickerModal';
import BrazilPlaceSearchField from '../../components/BrazilPlaceSearchField';
import FeedFuncaoPickerModal, { FeedFuncaoFieldButton } from '../../components/FeedFuncaoPickerModal';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useActiveArtistContext } from '../../contexts/ActiveArtistContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../services/useNotifications';
import { brazilUfFromStateName, formatCityAndRegion } from '../../lib/brazilGeo';
import { formatCalendarDate, formatCalendarDateLongParts, weekdayFromCalendarDate } from '../../lib/dateUtils';
import {
  ARTIST_MUSICAL_STYLE_PRESETS,
  ARTIST_SHOW_FORMAT_PRESETS,
  ARTIST_WORK_ROLE_PRESETS,
  normalizeShowFormats,
  parseArtistStringArrayFromJson,
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
import {
  ARTISTAS_BUSCA_PAGE_SIZE,
  aceitarConviteParticipacao,
  listarTodosArtistas,
  type ArtistaBuscaConvite,
} from '../../services/supabase/conviteParticipacaoEventoService';
import {
  alternarArtistaFavorito,
  listarArtistasFavoritos,
  listarIdsArtistasFavoritos,
} from '../../services/supabase/artistFavoritesService';
import {
  alternarEventoFavorito,
  listarIdsEventosFavoritos,
} from '../../services/supabase/eventFavoritesService';
import { useUnreadConversas } from '../../services/useUnreadConversas';
import { formatChatCache, openArtistChatInApp, type ShowChatContext } from '../../lib/openArtistChat';
import {
  oportunidadeCompativelComPerfil,
  perfilCompatFromArtist,
  type PerfilCompat,
} from '../../lib/feedCompatibility';
import { getArtistById } from '../../services/supabase/artistService';
import {
  listarVisualizacoesDoArtista,
  type OportunidadeVisualizacao,
} from '../../services/supabase/opportunityViewsService';
import { openWhatsAppConversation } from '../../utils/brazilPhone';

function formatTime(t: string) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

const FEED_COMO_FUNCIONA_SEEN_KEY = 'feed_marketplace_como_funciona_visto';
const FEED_ARTISTAS_UF_KEY = 'feed_artistas_ultimo_uf';
const COMPAT_GREEN = '#16A34A';

export default function FeedScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeArtist } = useActiveArtistContext();
  const { isAdmin, isVendedor } = usePermissions();
  const { unreadCount, loadUnreadCount } = useNotifications();
  const { unreadChats, refreshUnreadChats } = useUnreadConversas();
  const [filtro, setFiltro] = useState<FeedFiltro>('todos');
  const [verMinhas, setVerMinhas] = useState(false);
  const [verArtistas, setVerArtistas] = useState(false);
  const [buscaArtista, setBuscaArtista] = useState('');
  const [buscaArtistaDebounced, setBuscaArtistaDebounced] = useState('');
  const [artistasProximos, setArtistasProximos] = useState<ArtistaBuscaConvite[]>([]);
  const [loadingArtistas, setLoadingArtistas] = useState(false);
  const [loadingMoreArtistas, setLoadingMoreArtistas] = useState(false);
  const [artistasHasMore, setArtistasHasMore] = useState(true);
  const artistasLenRef = useRef(0);
  const artistasHasMoreRef = useRef(true);
  const loadingMoreArtistasRef = useRef(false);
  const artistasGenerationRef = useRef(0);
  const [artistasProntoGeo, setArtistasProntoGeo] = useState(false);
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [filtroGenero, setFiltroGenero] = useState('');
  const [filtroFuncaoArtista, setFiltroFuncaoArtista] = useState('');
  const [filtroFormatoArtista, setFiltroFormatoArtista] = useState('');
  const [filtroFavoritos, setFiltroFavoritos] = useState(false);
  const [filtroFavoritosFeed, setFiltroFavoritosFeed] = useState(false);
  const [filtroCompativel, setFiltroCompativel] = useState(false);
  const [meuPerfilCompat, setMeuPerfilCompat] = useState<PerfilCompat | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteEventIds, setFavoriteEventIds] = useState<Set<string>>(new Set());
  const canFavoriteOportunidade = isAdmin || isVendedor;
  const [estadoUfFeed, setEstadoUfFeed] = useState('');
  const [cidadeFeed, setCidadeFeed] = useState('');
  const [cidadeFeedDebounced, setCidadeFeedDebounced] = useState('');
  const [estadoUfArtistas, setEstadoUfArtistas] = useState('');
  const [cidadeArtistas, setCidadeArtistas] = useState('');
  const [cidadeArtistasDebounced, setCidadeArtistasDebounced] = useState('');
  const [showEstados, setShowEstados] = useState(false);
  const [showFuncaoPicker, setShowFuncaoPicker] = useState(false);
  const [showGeneroPicker, setShowGeneroPicker] = useState(false);
  const [showFuncaoArtistaPicker, setShowFuncaoArtistaPicker] = useState(false);
  const [showFormatoArtistaPicker, setShowFormatoArtistaPicker] = useState(false);
  const [anuncios, setAnuncios] = useState<FeedAnuncio[]>([]);
  const [propostasPorEvento, setPropostasPorEvento] = useState<Record<string, FeedProposta[]>>({});
  const [visualizacoesPorEvento, setVisualizacoesPorEvento] = useState<
    Record<string, OportunidadeVisualizacao[]>
  >({});
  const [viewsSheet, setViewsSheet] = useState<{
    title: string;
    items: OportunidadeVisualizacao[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
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
  const [aceiteInteresse, setAceiteInteresse] = useState<{
    item: FeedAnuncio;
    proposta: FeedProposta;
  } | null>(null);
  const [parceriaFeita, setParceriaFeita] = useState<{
    partnerName: string;
    eventName: string | null;
  } | null>(null);
  const [showComoFunciona, setShowComoFunciona] = useState(false);
  const [showFiltros, setShowFiltros] = useState(false);

  const loadGenerationRef = useRef(0);
  const marketplaceAbortRef = useRef<AbortController | null>(null);
  const artistasAbortRef = useRef<AbortController | null>(null);
  const feedFocusedRef = useRef(true);
  const verArtistasRef = useRef(false);

  const funcaoFilterOptions = useMemo(
    () => [...ARTIST_WORK_ROLE_PRESETS],
    []
  );
  const generoFilterOptions = useMemo(
    () => [...ARTIST_MUSICAL_STYLE_PRESETS],
    []
  );
  const formatoFilterOptions = useMemo(
    () => [...ARTIST_SHOW_FORMAT_PRESETS],
    []
  );
  const artistaFiltrosRef = useRef({
    estadoUf: '',
    cidade: '',
    genero: '',
    funcao: '',
    formato: '',
    nome: '',
    favoritos: false,
  });
  artistaFiltrosRef.current = {
    estadoUf: estadoUfArtistas,
    cidade: cidadeArtistasDebounced,
    genero: filtroGenero,
    funcao: filtroFuncaoArtista,
    formato: filtroFormatoArtista,
    nome: buscaArtistaDebounced,
    favoritos: filtroFavoritos,
  };
  const activeArtistIdRef = useRef(activeArtist?.id ?? null);
  activeArtistIdRef.current = activeArtist?.id ?? null;

  const load = useCallback(async (silent = false) => {
    if (verArtistas || !feedFocusedRef.current) return;
    const generation = ++loadGenerationRef.current;
    marketplaceAbortRef.current?.abort();
    const abort = new AbortController();
    marketplaceAbortRef.current = abort;
    if (!silent) {
      setAnuncios([]);
      setLoading(true);
    }
    const artistId = activeArtist?.id ?? null;
    try {
      if (abort.signal.aborted) return;
      const marketplaceRes = await listarFeedMarketplace({
        filtro: verMinhas ? 'meus' : 'todos',
        estadoUf: estadoUfFeed,
        cidade: cidadeFeedDebounced,
        funcao: filtroFuncao,
        artistaAtualId: artistId,
        abortSignal: abort.signal,
      });
      if (marketplaceRes.aborted || abort.signal.aborted || generation !== loadGenerationRef.current) return;

      if (generation !== loadGenerationRef.current) return;

      const favIds = await listarIdsEventosFavoritos();
      if (abort.signal.aborted || generation !== loadGenerationRef.current) return;
      setFavoriteEventIds(favIds);

      let visiveis =
        !marketplaceRes.error && verMinhas && artistId
          ? marketplaceRes.anuncios.filter((item) => item.artist_id === artistId)
          : !marketplaceRes.error
            ? marketplaceRes.anuncios
            : [];
      if (filtroFavoritosFeed) {
        visiveis = visiveis.filter((item) => favIds.has(item.id));
      }

      setAnuncios(visiveis);
      setError(visiveis.length === 0 ? marketplaceRes.error : marketplaceRes.error);

      if (artistId) {
        void (async () => {
          const { propostas, aborted } = await listarPropostasFeedMarketplace(artistId, abort.signal);
          if (aborted || abort.signal.aborted || generation !== loadGenerationRef.current) return;

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
        void (async () => {
          const { byEvent } = await listarVisualizacoesDoArtista(artistId);
          if (abort.signal.aborted || generation !== loadGenerationRef.current) return;
          setVisualizacoesPorEvento(byEvent);
        })();
      } else {
        setPropostasPorEvento({});
        setVisualizacoesPorEvento({});
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filtro, verMinhas, verArtistas, estadoUfFeed, cidadeFeedDebounced, filtroFuncao, filtroFavoritosFeed, activeArtist?.id]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaArtistaDebounced(buscaArtista.trim()), 280);
    return () => clearTimeout(t);
  }, [buscaArtista]);

  useEffect(() => {
    const t = setTimeout(() => setCidadeFeedDebounced(cidadeFeed.trim()), 450);
    return () => clearTimeout(t);
  }, [cidadeFeed]);

  useEffect(() => {
    const t = setTimeout(() => setCidadeArtistasDebounced(cidadeArtistas.trim()), 450);
    return () => clearTimeout(t);
  }, [cidadeArtistas]);

  useEffect(() => {
    let cancelled = false;
    if (!activeArtist?.id) {
      setMeuPerfilCompat(null);
      return;
    }
    void getArtistById(activeArtist.id).then(({ artist }) => {
      if (cancelled) return;
      setMeuPerfilCompat(perfilCompatFromArtist(artist));
    });
    return () => {
      cancelled = true;
    };
  }, [activeArtist?.id]);

  useEffect(() => {
    if (artistasProntoGeo) return;
    let cancelled = false;
    const geoAbort = new AbortController();
    void (async () => {
      try {
        if (!activeArtist?.id) return;
        const { data } = await supabase
          .rpc('estado_do_artista', { p_artista_id: activeArtist.id })
          .abortSignal(geoAbort.signal);
        if (cancelled || geoAbort.signal.aborted) return;
        const fromArtist = String(data || '');
        const uf =
          brazilUfFromStateName(fromArtist) ||
          (fromArtist.trim().length === 2 ? fromArtist.trim().toUpperCase() : null);
        if (uf) setEstadoUfArtistas(uf);
      } finally {
        if (!cancelled) setArtistasProntoGeo(true);
      }
    })();
    return () => {
      cancelled = true;
      geoAbort.abort();
    };
  }, [activeArtist?.id, artistasProntoGeo]);

  const loadArtistas = useCallback(async (opts: { silent?: boolean; append?: boolean } = {}) => {
    if (!verArtistasRef.current) return;
    feedFocusedRef.current = true;
    const append = Boolean(opts.append);
    if (append) {
      if (!artistasHasMoreRef.current || loadingMoreArtistasRef.current) return;
      loadingMoreArtistasRef.current = true;
      setLoadingMoreArtistas(true);
    } else {
      artistasHasMoreRef.current = true;
      setArtistasHasMore(true);
      if (!opts.silent) setLoadingArtistas(true);
    }
    const generation = ++artistasGenerationRef.current;
    if (!append) {
      artistasAbortRef.current?.abort();
      artistasAbortRef.current = new AbortController();
    } else if (!artistasAbortRef.current || artistasAbortRef.current.signal.aborted) {
      artistasAbortRef.current = new AbortController();
    }
    const abort = artistasAbortRef.current;
    const offset = append ? artistasLenRef.current : 0;
    try {
      const { estadoUf: estado, cidade, genero, funcao, formato, nome, favoritos } =
        artistaFiltrosRef.current;
      const listar = favoritos ? listarArtistasFavoritos : listarTodosArtistas;
      const { artists, hasMore, error: artistsError, aborted } = await listar({
        artistaAtualId: activeArtistIdRef.current,
        estado,
        cidade,
        genero,
        funcao,
        formato,
        termo: nome,
        limit: ARTISTAS_BUSCA_PAGE_SIZE,
        offset,
        abortSignal: abort.signal,
      });
      if (aborted || abort.signal.aborted || generation !== artistasGenerationRef.current) return;
      if (append) {
        setArtistasProximos((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const next = [...prev, ...artists.filter((item) => !seen.has(item.id))];
          artistasLenRef.current = next.length;
          return next;
        });
      } else {
        artistasLenRef.current = artists.length;
        setArtistasProximos(artists);
      }
      artistasHasMoreRef.current = hasMore;
      setArtistasHasMore(hasMore);
      setError(artists.length === 0 && !append ? artistsError : null);
    } catch {
      if (generation !== artistasGenerationRef.current) return;
      if (!append) {
        setArtistasProximos([]);
        artistasLenRef.current = 0;
        setError('Não foi possível carregar os artistas.');
      }
    } finally {
      if (generation === artistasGenerationRef.current) {
        setLoadingArtistas(false);
        setLoadingMoreArtistas(false);
        loadingMoreArtistasRef.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  const skipNextFocusLoadRef = useRef(true);
  const loadRef = useRef(load);
  const loadArtistasRef = useRef(loadArtistas);
  loadRef.current = load;
  loadArtistasRef.current = loadArtistas;

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
    setArtistasProximos([]);
    artistasLenRef.current = 0;
    artistasHasMoreRef.current = true;
    setArtistasHasMore(true);
    setEstadoUfFeed('');
    setCidadeFeed('');
    setCidadeFeedDebounced('');
    setEstadoUfArtistas('');
    setCidadeArtistas('');
    setCidadeArtistasDebounced('');
    setArtistasProntoGeo(false);
    skipNextFocusLoadRef.current = true;
  }, [activeArtist?.id]);

  useEffect(() => {
    if (!isAdmin && verMinhas) setVerMinhas(false);
  }, [isAdmin, verMinhas]);

  useEffect(() => {
    if (!activeArtist?.id || verArtistas) return;
    void load(false);
  }, [filtro, verMinhas, estadoUfFeed, cidadeFeedDebounced, filtroFuncao, filtroFavoritosFeed, activeArtist?.id, verArtistas, load]);

  useEffect(() => {
    if (!verArtistas || !artistasProntoGeo) return;
    setLoadingArtistas(true);
    setArtistasProximos([]);
    artistasLenRef.current = 0;
    void loadArtistas();
  }, [verArtistas, estadoUfArtistas, cidadeArtistasDebounced, filtroGenero, filtroFuncaoArtista, filtroFormatoArtista, filtroFavoritos, buscaArtistaDebounced, artistasProntoGeo, loadArtistas]);

  useFocusEffect(
    useCallback(() => {
      feedFocusedRef.current = true;
      void loadUnreadCount();
      void refreshUnreadChats();
      const skipFirst = skipNextFocusLoadRef.current;
      skipNextFocusLoadRef.current = false;
      if (!skipFirst) {
        if (verArtistasRef.current) {
          void loadArtistasRef.current();
        } else {
          void loadRef.current(true);
        }
      }
      return () => {
        feedFocusedRef.current = false;
        marketplaceAbortRef.current?.abort();
        artistasAbortRef.current?.abort();
      };
    }, [])
  );

  useEffect(() => {
    if (!verArtistas) return;
    let cancelled = false;
    void listarIdsArtistasFavoritos().then((ids) => {
      if (!cancelled) setFavoriteIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [verArtistas, activeArtist?.id]);

  const toggleFavorito = useCallback(async (artistId: string) => {
    if (!isAdmin) return;
    const wasFavorite = favoriteIds.has(artistId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(artistId);
      else next.add(artistId);
      return next;
    });
    const { favorite, error } = await alternarArtistaFavorito(artistId, wasFavorite);
    if (error) {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(artistId);
        else next.delete(artistId);
        return next;
      });
      return;
    }
    if (filtroFavoritos && !favorite) {
      setArtistasProximos((prev) => {
        const next = prev.filter((item) => item.id !== artistId);
        artistasLenRef.current = next.length;
        return next;
      });
    }
  }, [favoriteIds, filtroFavoritos, isAdmin]);

  const toggleFavoritoOportunidade = useCallback(async (eventId: string) => {
    if (!canFavoriteOportunidade) return;
    const wasFavorite = favoriteEventIds.has(eventId);
    setFavoriteEventIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
    const { favorite, error } = await alternarEventoFavorito(eventId, wasFavorite);
    if (error) {
      setFavoriteEventIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(eventId);
        else next.delete(eventId);
        return next;
      });
      Alert.alert('Favoritos', error);
      return;
    }
    if (filtroFavoritosFeed && !favorite) {
      setAnuncios((prev) => prev.filter((item) => item.id !== eventId));
    }
  }, [canFavoriteOportunidade, favoriteEventIds, filtroFavoritosFeed]);

  const emptyCopy = useMemo(() => {
    if (verArtistas) {
      if (filtroFavoritos) {
        return 'Nenhum artista favorito neste filtro. Toque no coração para salvar.';
      }
      if (buscaArtistaDebounced) {
        return 'Nenhum artista encontrado com esse nome.';
      }
      if (filtroGenero || filtroFuncaoArtista || filtroFormatoArtista || estadoUfArtistas || cidadeArtistas.trim()) {
        return 'Nenhum artista neste filtro.';
      }
      return 'Nenhum artista encontrado.';
    }
    if (filtroFuncao) {
      return `Nenhuma oportunidade com a função "${filtroFuncao}" neste filtro.`;
    }
    if (estadoUfFeed || cidadeFeed.trim()) {
      return 'Nenhuma oportunidade neste local. Limpe cidade ou estado para ver todas.';
    }
    if (filtroFavoritosFeed) {
      return 'Nenhuma oportunidade favorita neste filtro. Toque no coração para salvar.';
    }
    if (filtroCompativel) {
      return 'Nenhuma oportunidade combina com seu estilo, função ou formato. Atualize o perfil para aparecer mais.';
    }
    if (verMinhas) {
      return 'Você ainda não publicou no feed.';
    }
    return 'Ainda não há oportunidades no feed.';
  }, [filtro, verMinhas, filtroFuncao, filtroGenero, filtroFuncaoArtista, filtroFormatoArtista, filtroFavoritos, filtroFavoritosFeed, filtroCompativel, verArtistas, buscaArtistaDebounced, cidadeArtistas, estadoUfArtistas, cidadeFeed, estadoUfFeed]);

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
    if (!isAdmin) {
      setShowPermissionModal(true);
      return;
    }
    router.push('/publicar-feed');
  };

  const isMeuAnuncio = (item: FeedAnuncio) =>
    !!activeArtist?.id && item.artist_id === activeArtist.id;

  const anuncioCompativel = useCallback(
    (item: FeedAnuncio) =>
      oportunidadeCompativelComPerfil(item, meuPerfilCompat, activeArtist?.id),
    [meuPerfilCompat, activeArtist?.id]
  );

  const anunciosExibidos = useMemo(() => {
    if (!filtroCompativel) return anuncios;
    return anuncios.filter(anuncioCompativel);
  }, [anuncios, filtroCompativel, anuncioCompativel]);

  const openOportunidade = (item: FeedAnuncio) => {
    router.push({ pathname: '/oportunidade', params: { eventId: item.id } });
  };

  const handleNegociar = (item: FeedAnuncio) => {
    openOportunidade(item);
  };

  const handleWhatsappCandidato = async (artistId: string, artistName: string) => {
    const { artist } = await getArtistById(artistId);
    if (!artist?.show_whatsapp || !artist.whatsapp) {
      Alert.alert('WhatsApp', `${artistName} não deixou o WhatsApp público. Use o bate-papo do app.`);
      return;
    }
    void openWhatsAppConversation(artist.whatsapp);
  };

  const showContextFromFeed = (item: FeedAnuncio, extraFuncao?: string | null): ShowChatContext => {
    const horario = [formatTime(item.start_time), formatTime(item.end_time)].filter(Boolean).join(' – ');
    const funcoes = item.feed_funcoes.map((f) => f.trim()).filter(Boolean).join(', ');
    return {
      nome: item.evento_nome || item.artist_name,
      data: formatCalendarDate(item.event_date),
      horario: horario || null,
      local: formatCityAndRegion({ city: item.city, state_uf: item.state_uf }),
      funcao: extraFuncao || funcoes || null,
      cache: formatChatCache(item.cache_valor),
    };
  };

  const handleConversarFeed = (
    otherArtistId: string,
    otherArtistName?: string | null,
    otherArtistImage?: string | null,
    showContext?: ShowChatContext | null
  ) => {
    openArtistChatInApp({
      myArtistId: activeArtist?.id,
      isAdmin,
      otherArtistId,
      otherArtistName,
      otherArtistImage,
      showContext,
    });
  };

  const nomeDespesaProposta = (proposta: FeedProposta) => {
    const funcao =
      proposta.funcao && proposta.funcao.trim().toLowerCase() !== 'interesse'
        ? proposta.funcao.trim()
        : null;
    return funcao ? `${proposta.artista_nome} - ${funcao}` : proposta.artista_nome;
  };

  const aceitarPropostaFeed = async (item: FeedAnuncio, proposta: FeedProposta) => {
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
    setAceiteInteresse(null);
    void load();
    setParceriaFeita({
      partnerName: proposta.artista_nome,
      eventName: item.evento_nome?.trim() || null,
    });
  };

  const handlePropostaPress = (item: FeedAnuncio, proposta: FeedProposta) => {
    setAceiteInteresse({ item, proposta });
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
    const badgeColor = colors.primary;
    const location = formatCityAndRegion({
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
    const cacheDisplay = item.feed_mostrar_cache && cacheTxt ? `Até ${cacheTxt}` : 'Cachê a combinar';
    const propostas = meuAnuncio ? propostasPorEvento[item.id] || [] : [];
    const visualizacoes = meuAnuncio ? visualizacoesPorEvento[item.id] || [] : [];
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
    const funcoesTxt = item.feed_funcoes.length > 0 ? item.feed_funcoes.join(' · ') : '';
    const offerLine = funcoesTxt || 'Show nesta data';

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        onPress={() => openOportunidade(item)}
        activeOpacity={0.92}
      >
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.cardKind, { color: colors.primary }]}>Oportunidade</Text>
              {!meuAnuncio && anuncioCompativel(item) ? (
                <View style={styles.compatBadge}>
                  <Ionicons name="checkmark-circle" size={13} color={COMPAT_GREEN} />
                  <Text style={styles.compatBadgeText}>Compatível com você</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {canFavoriteOportunidade && !meuAnuncio ? (
                <TouchableOpacity
                  onPress={() => void toggleFavoritoOportunidade(item.id)}
                  hitSlop={10}
                  accessibilityLabel={
                    favoriteEventIds.has(item.id)
                      ? 'Remover dos favoritos'
                      : 'Favoritar oportunidade'
                  }
                >
                  <Ionicons
                    name={favoriteEventIds.has(item.id) ? 'heart' : 'heart-outline'}
                    size={20}
                    color={favoriteEventIds.has(item.id) ? '#EF4444' : colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
              {meuAnuncio ? (
                <TouchableOpacity
                  onPress={() => setAnuncioMenu(item)}
                  hitSlop={10}
                  accessibilityLabel="Mais opções"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

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
              <Text style={[styles.cachePillText, { color: colors.text }]}>{cacheDisplay}</Text>
            </View>
          ) : null}

          {item.description ? (
            <Text style={[styles.notes, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          {meuAnuncio && visualizacoes.length > 0 ? (
            <TouchableOpacity
              style={styles.viewsCardRow}
              onPress={() =>
                setViewsSheet({
                  title: item.evento_nome?.trim() || 'Oportunidade',
                  items: visualizacoes,
                })
              }
              activeOpacity={0.8}
            >
              <View style={styles.avatarStack}>
                {visualizacoes.slice(0, 4).map((viewer, index) => {
                  const initial = viewer.artistName.trim().charAt(0).toUpperCase() || '?';
                  return (
                    <View
                      key={viewer.artistId}
                      style={[
                        styles.viewAvatar,
                        {
                          marginLeft: index === 0 ? 0 : -8,
                          zIndex: 10 - index,
                          backgroundColor: colors.secondary,
                          borderColor: colors.surface,
                        },
                      ]}
                    >
                      {viewer.artistImage ? (
                        <OptimizedImage
                          imageUrl={viewer.artistImage}
                          style={styles.viewAvatarImg}
                          fallbackText={initial}
                          fallbackIconSize={10}
                          showLoadingIndicator={false}
                        />
                      ) : (
                        <Text style={[styles.viewAvatarInitial, { color: colors.primary }]}>{initial}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={[styles.countPillText, { color: colors.textSecondary }]}>
                {visualizacoes.length === 1
                  ? '1 visualizou'
                  : `${visualizacoes.length} visualizaram`}
              </Text>
            </TouchableOpacity>
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
              {item.propostas_count === 1
                ? '1 candidato'
                : `${item.propostas_count} candidatos`}
            </Text>
          </View>
        ) : null}

        {meuAnuncio && propostas.length > 0 ? (
          <View style={[styles.propostasBox, { borderColor: colors.border }]}>
            {propostas.map((proposta) => (
              <View key={proposta.convite_id} style={styles.propostaRow}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
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
                        ? 'Já aceito nesta oportunidade'
                        : 'Quer participar · toque para ver'}
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
                <TouchableOpacity
                  onPress={() =>
                    handleConversarFeed(
                      proposta.artista_id,
                      proposta.artista_nome,
                      proposta.artista_image,
                      showContextFromFeed(item, proposta.funcao)
                    )
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingLeft: 8 }}
                  accessibilityLabel={`Conversar no app com ${proposta.artista_nome}`}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void handleWhatsappCandidato(proposta.artista_id, proposta.artista_nome)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingLeft: 6 }}
                  accessibilityLabel={`WhatsApp de ${proposta.artista_nome}`}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {!meuAnuncio ? (
          <View style={{ gap: 8 }}>
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
                {item.ja_proposei ? 'Ver oportunidade' : 'Tenho interesse'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btnOutline,
                { borderColor: colors.border, flexDirection: 'row', justifyContent: 'center', gap: 6 },
              ]}
              onPress={() =>
                handleConversarFeed(
                  item.artist_id,
                  item.artist_name,
                  item.artist_image,
                  showContextFromFeed(item)
                )
              }
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
              <Text style={[styles.btnOutlineText, { color: colors.primary }]}>Conversar</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: FeedAnuncio }) => renderMarketplaceItem(item);

  const renderArtistaProximo = ({ item }: { item: ArtistaBuscaConvite }) => {
    const avatar = item.image_url?.trim() || item.profile_url?.trim() || '';
    const initial = item.name.trim().charAt(0).toUpperCase() || '?';
    const place = [item.city, item.state].filter(Boolean).join(' / ');
    const genre = item.musical_style?.trim() || '';
    const formats = normalizeShowFormats(item.show_formats).slice(0, 2);
    const roles = parseArtistStringArrayFromJson(item.work_roles).slice(0, 3);
    const tags = [...formats, ...roles.filter((role) => !formats.includes(role))].slice(0, 4);
    const favorito = favoriteIds.has(item.id);
    const openProfile = () =>
      router.push({ pathname: '/perfil-artista', params: { artistId: item.id } });
    return (
      <TouchableOpacity
        style={[styles.artistRow, { alignItems: tags.length ? 'flex-start' : 'center' }]}
        onPress={openProfile}
        activeOpacity={0.7}
      >
        <View style={[styles.artistAvatar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.artistAvatarImg} contentFit="cover" />
          ) : (
            <Text style={[styles.artistAvatarInitial, { color: colors.text }]}>{initial}</Text>
          )}
        </View>
        <View style={styles.artistCopy}>
          <Text style={[styles.artistNameRow, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.tem_show_hoje ? (
            <Text style={[styles.artistShowHoje, { color: colors.primary }]}>tem show hoje</Text>
          ) : null}
          {genre ? (
            <Text style={[styles.artistStyle, { color: colors.textSecondary }]} numberOfLines={1}>
              {genre}
            </Text>
          ) : null}
          {place ? (
            <Text style={[styles.artistPlace, { color: colors.textSecondary }]} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          {tags.length ? (
            <View style={styles.artistRoles}>
              {tags.map((tag) => (
                <View
                  key={tag}
                  style={[
                    styles.artistRoleTag,
                    { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}28` },
                  ]}
                >
                  <Text style={[styles.artistRoleTagText, { color: colors.primary }]} numberOfLines={1}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        {isAdmin ? (
          <TouchableOpacity
            onPress={() => void toggleFavorito(item.id)}
            hitSlop={10}
            style={styles.artistHeartBtn}
          >
            <Ionicons
              name={favorito ? 'heart' : 'heart-outline'}
              size={20}
              color={favorito ? '#EF4444' : colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
        <View style={[styles.artistFollow, { borderColor: colors.border, marginTop: roles.length ? 4 : 0 }]}>
          <Text style={[styles.artistFollowText, { color: colors.text }]}>Ver</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Feed' }} />
      <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 20,
          },
        ]}
      >
        {activeArtist ? (
          <View style={styles.artistHeader}>
            <TouchableOpacity
              onPress={() => router.push('/selecionar-artista')}
              activeOpacity={0.8}
            >
              <OptimizedImage
                imageUrl={activeArtist.profile_url || ''}
                style={[styles.headerAvatar, { borderColor: colors.border }]}
                cacheKey={`artist_${activeArtist.id}`}
                fallbackText={activeArtist.name || 'Artista'}
                fallbackIcon="musical-notes"
                fallbackIconSize={24}
                fallbackIconColor={colors.primary}
                showLoadingIndicator={false}
              />
            </TouchableOpacity>
            <View style={styles.headerArtistDetails}>
              <View style={styles.headerNameRow}>
                <Text style={[styles.headerArtistName, { color: colors.text }]} numberOfLines={2}>
                  {activeArtist.name}
                </Text>
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    style={styles.notificationButton}
                    onPress={() => setShowComoFunciona(true)}
                    accessibilityLabel="Como funciona o Feed"
                  >
                    <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.notificationButton}
                    onPress={() => router.push('/conversas')}
                    accessibilityLabel="Conversas"
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
                    {unreadChats > 0 ? (
                      <View style={styles.notificationBadge}>
                        <Text style={styles.badgeText}>
                          {unreadChats > 99 ? '99+' : unreadChats.toString()}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.notificationButton}
                    onPress={() => router.push('/notificacoes')}
                  >
                    <Ionicons name="notifications-outline" size={22} color={colors.primary} />
                    {unreadCount > 0 ? (
                      <View style={styles.notificationBadge}>
                        <Text style={styles.badgeText}>
                          {unreadCount > 99 ? '99+' : unreadCount.toString()}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Feed</Text>
            </View>
          </View>
        ) : (
          <View style={styles.noArtistHeader}>
            <Text style={[styles.headerArtistName, { color: colors.text }]}>Feed</Text>
            <TouchableOpacity
              style={styles.notificationButton}
              onPress={() => router.push('/conversas')}
              accessibilityLabel="Conversas"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={24} color={colors.primary} />
              {unreadChats > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.badgeText}>
                    {unreadChats > 99 ? '99+' : unreadChats.toString()}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.notificationButton}
              onPress={() => router.push('/notificacoes')}
            >
              <Ionicons name="notifications-outline" size={24} color={colors.primary} />
              {unreadCount > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount.toString()}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.mainSeg, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.mainSegBtn,
              !verArtistas && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              artistasAbortRef.current?.abort();
              verArtistasRef.current = false;
              setVerArtistas(false);
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.mainSegText, { color: !verArtistas ? '#fff' : colors.text }]}>
              Oportunidades
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.mainSegBtn,
              verArtistas && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              marketplaceAbortRef.current?.abort();
              loadGenerationRef.current += 1;
              setVerMinhas(false);
              verArtistasRef.current = true;
              feedFocusedRef.current = true;
              setShowFiltros(false);
              setVerArtistas(true);
              setLoadingArtistas(!estadoUfArtistas && !artistasProntoGeo);
              setArtistasProximos([]);
              artistasLenRef.current = 0;
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.mainSegText, { color: verArtistas ? '#fff' : colors.text }]}>
              Artistas
            </Text>
          </TouchableOpacity>
        </View>

        {!verArtistas && isAdmin ? (
          <View style={styles.subTabs}>
            <TouchableOpacity
              style={[styles.subTab, !verMinhas && { borderBottomColor: colors.primary }]}
              onPress={() => {
                if (!verMinhas) {
                  void load(false);
                  return;
                }
                setVerMinhas(false);
                setFiltro('todos');
              }}
            >
              <Text
                style={[
                  styles.subTabText,
                  { color: !verMinhas ? colors.primary : colors.textSecondary },
                ]}
              >
                Todas
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subTab, verMinhas && { borderBottomColor: colors.primary }]}
              onPress={() => {
                if (verMinhas) {
                  void load(false);
                  return;
                }
                setVerMinhas(true);
              }}
            >
              <Text
                style={[
                  styles.subTabText,
                  { color: verMinhas ? colors.primary : colors.textSecondary },
                ]}
              >
                Minhas
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!verMinhas ? (
          <>
            <View style={styles.metaRow}>
              <Text style={[styles.nearHint, { color: colors.textSecondary }]} numberOfLines={1}>
                {verArtistas
                  ? [filtroGenero, filtroFuncaoArtista, filtroFormatoArtista, cidadeArtistas.trim(), estadoUfArtistas].filter(Boolean).join(' · ')
                  : `${anunciosExibidos.length} ${anunciosExibidos.length === 1 ? 'oportunidade' : 'oportunidades'}${
                      filtroCompativel ? ' · compatíveis' : ''
                    }${
                      cidadeFeed.trim() || estadoUfFeed
                        ? ` · ${[cidadeFeed.trim(), estadoUfFeed].filter(Boolean).join(' - ')}`
                        : ''
                    }`}
              </Text>
              {(verArtistas ? loadingArtistas : loading) ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
              ) : null}
              {verArtistas && isAdmin ? (
                <TouchableOpacity
                  style={styles.filterToggle}
                  onPress={() => setFiltroFavoritos((v) => !v)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={filtroFavoritos ? 'heart' : 'heart-outline'}
                    size={18}
                    color={filtroFavoritos ? '#EF4444' : colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
              {!verArtistas ? (
                <TouchableOpacity
                  style={styles.filterToggle}
                  onPress={() => setFiltroCompativel((v) => !v)}
                  hitSlop={8}
                  accessibilityLabel="Filtrar oportunidades compatíveis com você"
                >
                  <Ionicons
                    name={filtroCompativel ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={18}
                    color={filtroCompativel ? COMPAT_GREEN : colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
              {!verArtistas && canFavoriteOportunidade ? (
                <TouchableOpacity
                  style={styles.filterToggle}
                  onPress={() => setFiltroFavoritosFeed((v) => !v)}
                  hitSlop={8}
                  accessibilityLabel="Filtrar oportunidades favoritas"
                >
                  <Ionicons
                    name={filtroFavoritosFeed ? 'heart' : 'heart-outline'}
                    size={18}
                    color={filtroFavoritosFeed ? '#EF4444' : colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.filterToggle}
                onPress={() => setShowFiltros((v) => !v)}
                hitSlop={8}
              >
                <Ionicons
                  name={showFiltros ? 'options' : 'options-outline'}
                  size={18}
                  color={
                    verArtistas
                      ? estadoUfArtistas || cidadeArtistas.trim() || filtroGenero || filtroFuncaoArtista || filtroFormatoArtista || filtroFavoritos
                        ? colors.primary
                        : colors.textSecondary
                      : cidadeFeed || estadoUfFeed || filtroFuncao || filtroFavoritosFeed || filtroCompativel
                        ? colors.primary
                        : colors.textSecondary
                  }
                />
              </TouchableOpacity>
            </View>
            {showFiltros ? (
              <View style={styles.filtrosBox}>
                {verArtistas ? (
                  <>
                    <View
                      style={[
                        styles.artistSearch,
                        {
                          backgroundColor: colors.surface,
                          borderColor: buscaArtista.trim() ? colors.primary : colors.border,
                          marginBottom: 8,
                        },
                      ]}
                    >
                      <Ionicons name="search-outline" size={15} color={colors.textSecondary} />
                      <TextInput
                        value={buscaArtista}
                        onChangeText={setBuscaArtista}
                        placeholder="Buscar artista"
                        placeholderTextColor={colors.textSecondary}
                        style={[styles.artistSearchInput, { color: colors.text }]}
                        autoCorrect={false}
                        returnKeyType="search"
                      />
                      {buscaArtista.trim() ? (
                        <TouchableOpacity onPress={() => setBuscaArtista('')} hitSlop={10}>
                          <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={styles.geoRow}>
                      <TouchableOpacity
                        style={[
                          styles.geoField,
                          styles.geoUf,
                          {
                            backgroundColor: colors.surface,
                            borderColor: estadoUfArtistas ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => setShowEstados(true)}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[styles.geoFieldText, { color: estadoUfArtistas ? colors.text : colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {estadoUfArtistas || 'Todos'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <View
                        style={[
                          styles.geoField,
                          styles.geoCity,
                          {
                            backgroundColor: colors.surface,
                            borderColor: cidadeArtistas.trim() ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
                        <TextInput
                          value={cidadeArtistas}
                          onChangeText={setCidadeArtistas}
                          placeholder="Digite a cidade"
                          placeholderTextColor={colors.textSecondary}
                          style={[styles.geoInput, { color: colors.text }]}
                          autoCorrect={false}
                          autoCapitalize="words"
                          returnKeyType="search"
                        />
                        {cidadeArtistas.trim() ? (
                          <TouchableOpacity
                            onPress={() => {
                              setCidadeArtistas('');
                              setCidadeArtistasDebounced('');
                            }}
                            hitSlop={10}
                          >
                            <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.funcaoRow}>
                      <FeedFuncaoFieldButton
                        selectedFuncao={filtroGenero}
                        onPress={() => setShowGeneroPicker(true)}
                        colors={colors}
                        emptyLabel="Todos os gêneros"
                        icon="musical-notes-outline"
                      />
                      <FeedFuncaoFieldButton
                        selectedFuncao={filtroFuncaoArtista}
                        onPress={() => setShowFuncaoArtistaPicker(true)}
                        colors={colors}
                        emptyLabel="Todas as funções"
                        icon="mic-outline"
                      />
                      <FeedFuncaoFieldButton
                        selectedFuncao={filtroFormatoArtista}
                        onPress={() => setShowFormatoArtistaPicker(true)}
                        colors={colors}
                        emptyLabel="Todos os formatos"
                        icon="people-outline"
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.geoRow}>
                      <TouchableOpacity
                        style={[
                          styles.geoField,
                          styles.geoUf,
                          {
                            backgroundColor: colors.surface,
                            borderColor: estadoUfFeed ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => setShowEstados(true)}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[styles.geoFieldText, { color: estadoUfFeed ? colors.text : colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {estadoUfFeed || 'UF'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <View
                        style={[
                          styles.geoField,
                          styles.geoCity,
                          {
                            backgroundColor: colors.surface,
                            borderColor: cidadeFeed.trim() ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <BrazilPlaceSearchField
                          compact
                          uf={estadoUfFeed}
                          value={cidadeFeed}
                          onChangeText={setCidadeFeed}
                          onSelectPlace={(place) => {
                            setCidadeFeed(place.city);
                            setCidadeFeedDebounced(place.city);
                            if (place.uf) setEstadoUfFeed(place.uf);
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
                    <TouchableOpacity
                      style={[
                        styles.compatFilterBtn,
                        {
                          borderColor: filtroCompativel ? COMPAT_GREEN : colors.border,
                          backgroundColor: filtroCompativel ? '#DCFCE7' : colors.surface,
                        },
                      ]}
                      onPress={() => setFiltroCompativel((v) => !v)}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={filtroCompativel ? 'checkmark-circle' : 'checkmark-circle-outline'}
                        size={18}
                        color={filtroCompativel ? COMPAT_GREEN : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.compatFilterText,
                          { color: filtroCompativel ? COMPAT_GREEN : colors.text },
                        ]}
                      >
                        Compatível com você
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {error ? (
        <TouchableOpacity
          style={[styles.errorBanner, { backgroundColor: `${colors.primary}12` }]}
          onPress={() => void (verArtistas ? loadArtistas() : load())}
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
      ) : (verArtistas ? loadingArtistas && artistasProximos.length === 0 : loading && anunciosExibidos.length === 0) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : verArtistas ? (
        <FlatList
          key={`artistas-${activeArtist?.id ?? 'sem-artista'}`}
          data={artistasProximos}
          keyExtractor={(item) => item.id}
          renderItem={renderArtistaProximo}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (artistasProximos.length === 0 || loadingArtistas || loadingMoreArtistas) return;
            void loadArtistas({ silent: true, append: true });
          }}
          contentContainerStyle={artistasProximos.length === 0 ? styles.emptyList : styles.artistList}
          ItemSeparatorComponent={() => (
            <View style={[styles.artistSep, { backgroundColor: colors.border }]} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadArtistas();
              }}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            loadingMoreArtistas ? (
              <View style={styles.artistFooter}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="people-outline" size={42} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Filtrar artistas</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>{emptyCopy}</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          key={activeArtist?.id ?? 'sem-artista'}
          data={anunciosExibidos}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={5}
          maxToRenderPerBatch={4}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={anunciosExibidos.length === 0 ? styles.emptyList : styles.list}
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

      {activeArtist && !verArtistas && isAdmin ? (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={handlePublicar}
          accessibilityLabel="Publicar oportunidade"
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <BrazilStatePickerModal
        visible={showEstados}
        onClose={() => setShowEstados(false)}
        selectedUf={verArtistas ? estadoUfArtistas : estadoUfFeed}
        todosLabel={verArtistas ? 'Todos os estados' : undefined}
        onSelect={(uf) => {
          const next = uf || '';
          if (verArtistas) {
            setEstadoUfArtistas(next);
            if (next) void AsyncStorage.setItem(FEED_ARTISTAS_UF_KEY, next);
            else void AsyncStorage.removeItem(FEED_ARTISTAS_UF_KEY);
          } else {
            setEstadoUfFeed(next);
          }
        }}
      />
      <FeedFuncaoPickerModal
        visible={showFuncaoPicker}
        onClose={() => setShowFuncaoPicker(false)}
        options={funcaoFilterOptions}
        selectedFuncao={filtroFuncao}
        onSelect={(funcao) => setFiltroFuncao(funcao || '')}
      />
      <FeedFuncaoPickerModal
        visible={showGeneroPicker}
        onClose={() => setShowGeneroPicker(false)}
        options={generoFilterOptions}
        selectedFuncao={filtroGenero}
        onSelect={(genero) => setFiltroGenero(genero || '')}
        title="Filtrar por gênero"
        searchPlaceholder="Buscar gênero..."
        clearLabel="Todos os gêneros"
        emptyLabel="Nenhum gênero encontrado."
      />
      <FeedFuncaoPickerModal
        visible={showFuncaoArtistaPicker}
        onClose={() => setShowFuncaoArtistaPicker(false)}
        options={funcaoFilterOptions}
        selectedFuncao={filtroFuncaoArtista}
        onSelect={(funcao) => setFiltroFuncaoArtista(funcao || '')}
        title="Filtrar por função"
        searchPlaceholder="Buscar função..."
        clearLabel="Todas as funções"
        emptyLabel="Nenhuma função encontrada."
      />
      <FeedFuncaoPickerModal
        visible={showFormatoArtistaPicker}
        onClose={() => setShowFormatoArtistaPicker(false)}
        options={formatoFilterOptions}
        selectedFuncao={filtroFormatoArtista}
        onSelect={(formato) => setFiltroFormatoArtista(formato || '')}
        title="Filtrar por formato de show"
        searchPlaceholder="Buscar formação..."
        clearLabel="Todos os formatos"
        emptyLabel="Nenhum formato encontrado."
      />
      <ArtistReviewsModal
        visible={!!reviewsArtist}
        artistId={reviewsArtist?.id ?? null}
        artistName={reviewsArtist?.name ?? 'Artista'}
        artistImage={reviewsArtist?.image}
        onClose={() => setReviewsArtist(null)}
      />
      <FeedComoFuncionaModal visible={showComoFunciona} onClose={fecharComoFunciona} />
      <ParceriaFeitaModal
        visible={!!parceriaFeita}
        partnerName={parceriaFeita?.partnerName}
        eventName={parceriaFeita?.eventName}
        onClose={() => setParceriaFeita(null)}
        onVerAgenda={() => {
          setParceriaFeita(null);
          router.push('/(tabs)/agenda');
        }}
      />
      <PermissionModal
        visible={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        title="Sem permissão"
        message="Somente o administrador publica oportunidades. O vendedor pode favoritar e, se tiver permissão, iniciar negociação."
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
        visible={!!viewsSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setViewsSheet(null)}
      >
        <Pressable style={styles.acceptOverlay} onPress={() => setViewsSheet(null)}>
          <Pressable
            style={[styles.viewsSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.viewsSheetTitle, { color: colors.text }]}>Quem visualizou</Text>
            <Text style={[styles.viewsSheetSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {viewsSheet?.title}
            </Text>
            <ScrollView style={styles.viewsSheetList} keyboardShouldPersistTaps="handled">
              {(viewsSheet?.items || []).map((viewer) => {
                const initial = viewer.artistName.trim().charAt(0).toUpperCase() || '?';
                return (
                  <TouchableOpacity
                    key={viewer.artistId}
                    style={styles.viewsSheetRow}
                    onPress={() => {
                      setViewsSheet(null);
                      router.push({ pathname: '/perfil-artista', params: { artistId: viewer.artistId } });
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.viewsSheetAvatar, { backgroundColor: colors.background }]}>
                      {viewer.artistImage ? (
                        <OptimizedImage
                          imageUrl={viewer.artistImage}
                          style={styles.viewsSheetAvatarImg}
                          fallbackText={initial}
                          fallbackIconSize={16}
                          showLoadingIndicator={false}
                        />
                      ) : (
                        <Text style={[styles.viewsSheetInitial, { color: colors.primary }]}>{initial}</Text>
                      )}
                    </View>
                    <Text style={[styles.viewsSheetName, { color: colors.text }]} numberOfLines={1}>
                      {viewer.artistName}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!aceiteInteresse}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!aceitandoConviteId) setAceiteInteresse(null);
        }}
      >
        <Pressable
          style={styles.acceptOverlay}
          onPress={() => {
            if (!aceitandoConviteId) setAceiteInteresse(null);
          }}
        >
          <Pressable
            style={[styles.acceptCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            {aceiteInteresse ? (
              <>
                {(() => {
                  const { item, proposta } = aceiteInteresse;
                  const jaAceito = proposta.status === 'aceito';
                  const funcao =
                    proposta.funcao && proposta.funcao.trim().toLowerCase() !== 'interesse'
                      ? proposta.funcao.trim()
                      : null;
                  const nomeOportunidade = item.evento_nome?.trim() || 'esta oportunidade';
                  const quando = [
                    weekdayFromCalendarDate(item.event_date),
                    formatCalendarDate(item.event_date),
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const horario = [formatTime(item.start_time), formatTime(item.end_time)]
                    .filter(Boolean)
                    .join(' – ');
                  const local = formatCityAndRegion({ city: item.city, state_uf: item.state_uf });
                  const cacheTxt =
                    item.cache_valor != null
                      ? Number(item.cache_valor).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })
                      : null;
                  const initial = proposta.artista_nome.trim().charAt(0).toUpperCase() || '?';
                  return (
                    <>
                      <Text style={[styles.acceptKicker, { color: colors.primary }]}>
                        {jaAceito ? 'Interesse aceito' : 'Quem demonstrou interesse'}
                      </Text>
                      <View style={styles.acceptWhoRow}>
                        <View
                          style={[
                            styles.acceptAvatar,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          {proposta.artista_image ? (
                            <OptimizedImage
                              imageUrl={proposta.artista_image}
                              style={styles.acceptAvatarImg}
                              fallbackIcon="person"
                              fallbackIconSize={18}
                            />
                          ) : (
                            <Text style={[styles.acceptAvatarInitial, { color: colors.primary }]}>
                              {initial}
                            </Text>
                          )}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.acceptWhoName, { color: colors.text }]} numberOfLines={2}>
                            {proposta.artista_nome}
                          </Text>
                          <Text style={[styles.acceptWhoRole, { color: colors.textSecondary }]}>
                            {funcao
                              ? `Interessado como ${funcao}`
                              : 'Artista interessado na sua oportunidade'}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.acceptBox,
                          { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      >
                        <Text style={[styles.acceptBoxLabel, { color: colors.textSecondary }]}>
                          Oportunidade
                        </Text>
                        <Text style={[styles.acceptBoxValue, { color: colors.text }]}>
                          {nomeOportunidade}
                        </Text>
                        {quando ? (
                          <Text style={[styles.acceptBoxMeta, { color: colors.text }]}>{quando}</Text>
                        ) : null}
                        {horario ? (
                          <Text style={[styles.acceptBoxMeta, { color: colors.textSecondary }]}>
                            Horário {horario}
                          </Text>
                        ) : null}
                        {local ? (
                          <Text style={[styles.acceptBoxMeta, { color: colors.textSecondary }]}>
                            {local}
                          </Text>
                        ) : null}
                      </View>

                      {cacheTxt ? (
                        <View
                          style={[
                            styles.acceptBox,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[styles.acceptBoxLabel, { color: colors.textSecondary }]}>
                            Cachê (vira despesa)
                          </Text>
                          <Text style={[styles.acceptBoxValue, { color: colors.text }]}>{cacheTxt}</Text>
                          <Text style={[styles.acceptBoxMeta, { color: colors.textSecondary }]}>
                            Lançada no financeiro como {nomeDespesaProposta(proposta)}
                          </Text>
                        </View>
                      ) : null}

                      {proposta.mensagem?.trim() ? (
                        <View
                          style={[
                            styles.acceptBox,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[styles.acceptBoxLabel, { color: colors.textSecondary }]}>
                            Recado de {proposta.artista_nome.split(' ')[0]}
                          </Text>
                          <Text style={[styles.acceptBoxMeta, { color: colors.text }]}>
                            {proposta.mensagem.trim()}
                          </Text>
                        </View>
                      ) : null}

                      <Text style={[styles.acceptHint, { color: colors.textSecondary }]}>
                        {jaAceito
                          ? 'Este artista já está na agenda desta oportunidade.'
                          : 'Ao aceitar, o show entra na agenda dos dois artistas, o cachê vira despesa e o anúncio sai do mural.'}
                      </Text>

                      <View style={styles.acceptActions}>
                        <TouchableOpacity
                          style={[styles.btnOutline, { borderColor: colors.border, flex: 1 }]}
                          onPress={() => setAceiteInteresse(null)}
                          disabled={!!aceitandoConviteId}
                        >
                          <Text style={[styles.btnOutlineText, { color: colors.textSecondary }]}>
                            {jaAceito ? 'Fechar' : 'Agora não'}
                          </Text>
                        </TouchableOpacity>
                        {!jaAceito ? (
                          <TouchableOpacity
                            style={[styles.btnPrimary, { backgroundColor: colors.primary, flex: 1 }]}
                            onPress={() => void aceitarPropostaFeed(item, proposta)}
                            disabled={!!aceitandoConviteId}
                          >
                            {aceitandoConviteId === proposta.convite_id ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <Text style={styles.btnPrimaryText}>Aceitar interesse</Text>
                            )}
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </>
                  );
                })()}
              </>
            ) : null}
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
                <Text style={[styles.menuSummaryTipo, { color: colors.primary }]}>
                  Oportunidade
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
                    : 'Show nesta data'}
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
                        ? 'Ver 1 candidato'
                        : `Ver ${anuncioMenu.propostas_count} candidatos`}
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
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  artistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    borderWidth: 2,
  },
  headerArtistDetails: { flex: 1, minWidth: 0 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerArtistName: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 4 },
  headerSubtitle: { fontSize: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', marginRight: -8 },
  noArtistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  notificationButton: { position: 'relative', padding: 8 },
  notificationBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  mainSeg: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  mainSegBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  mainSegText: { fontSize: 13, fontWeight: '800' },
  subTabs: {
    flexDirection: 'row',
    marginTop: 6,
    marginHorizontal: -8,
  },
  subTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  subTabText: { fontSize: 12, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    gap: 8,
  },
  filterToggle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtrosBox: { paddingTop: 6, paddingBottom: 4 },
  geoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    zIndex: 8,
    overflow: 'visible',
  },
  geoField: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  geoUf: { width: 78 },
  geoCity: { flex: 1, minWidth: 0 },
  geoFieldText: { flex: 1, fontSize: 14, fontWeight: '700' },
  geoInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 0,
    minWidth: 0,
  },
  funcaoRow: {
    paddingTop: 6,
    gap: 8,
  },
  compatFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  compatFilterText: { flex: 1, fontSize: 14, fontWeight: '700' },
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
  artistSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 36,
  },
  artistSearchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  nearHint: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  artistList: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 96 },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  artistSep: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  artistAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistAvatarImg: { width: '100%', height: '100%' },
  artistAvatarInitial: { fontSize: 18, fontWeight: '600' },
  artistCopy: { flex: 1, minWidth: 0 },
  artistNameRow: { fontSize: 15, fontWeight: '700' },
  artistShowHoje: { marginTop: 2, fontSize: 12, fontWeight: '800' },
  artistStyle: { fontSize: 13, marginTop: 2, fontWeight: '400' },
  artistPlace: { fontSize: 12, marginTop: 2 },
  artistRoles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  artistRoleTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  artistRoleTagText: { fontSize: 11, fontWeight: '600' },
  artistHeartBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  artistFollow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  artistFollowText: { fontSize: 13, fontWeight: '600' },
  artistFooter: { paddingVertical: 18, alignItems: 'center' },
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
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardKind: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  compatBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  compatBadgeText: {
    color: COMPAT_GREEN,
    fontSize: 11,
    fontWeight: '800',
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
  viewsCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  viewAvatarImg: { width: 26, height: 26, borderRadius: 13 },
  viewAvatarInitial: { fontSize: 11, fontWeight: '800' },
  viewsSheet: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  viewsSheetTitle: { fontSize: 18, fontWeight: '800' },
  viewsSheetSub: { marginTop: 2, marginBottom: 12, fontSize: 13 },
  viewsSheetList: { flexGrow: 0 },
  viewsSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  viewsSheetAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewsSheetAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  viewsSheetInitial: { fontSize: 16, fontWeight: '800' },
  viewsSheetName: { flex: 1, fontSize: 16, fontWeight: '700' },
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
  acceptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  acceptCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 12,
  },
  acceptKicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  acceptWhoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  acceptAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptAvatarImg: { width: 52, height: 52 },
  acceptAvatarInitial: { fontSize: 20, fontWeight: '800' },
  acceptWhoName: { fontSize: 18, fontWeight: '800' },
  acceptWhoRole: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  acceptBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  acceptBoxLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  acceptBoxValue: { fontSize: 16, fontWeight: '800' },
  acceptBoxMeta: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  acceptHint: { fontSize: 13, lineHeight: 18 },
  acceptActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
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
