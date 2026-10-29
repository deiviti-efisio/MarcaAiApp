import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ESTADOS_BRASIL } from '../constants/estadosBrasil';
import FeedFuncaoPickerModal, { FeedFuncaoFieldButton } from '../components/FeedFuncaoPickerModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../components/OptimizedImage';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { getEventById } from '../services/supabase/eventService';
import {
  ARTIST_MUSICAL_STYLE_PRESETS,
  ARTIST_SHOW_FORMAT_PRESETS,
  ARTIST_WORK_ROLE_PRESETS,
  normalizeShowFormats,
  parseArtistStringArrayFromJson,
} from '../constants/artistProfileLists';
import {
  listarAvaliacoesPublicasArtistaParaConvite,
  buscarArtistasParaConvite,
  enviarConviteParticipacao,
  enviarConvitesParticipacaoLeilaoLote,
  listarResumoAvaliacoesArtistasParaConvite,
  listarConvitesDoEvento,
  listarParceirosRecentesParticipacao,
  type AvaliacaoPublicaArtistaConvite,
  type ArtistaBuscaConvite,
  type ParceiroRecenteParticipacao,
  type ResumoAvaliacaoArtistaConvite,
} from '../services/supabase/conviteParticipacaoEventoService';
import { getUserProfile } from '../services/supabase/userService';
import { useActiveArtist } from '../services/useActiveArtist';
import { brazilMobileDigits, maskBrazilMobile } from '../utils/brazilPhone';
import {
  extractNumericValueString,
  formatCurrencyBRLFromAmount,
  formatCurrencyBRLInput,
} from '../utils/currencyBRLInput';

function newInviteDisputeGroupId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Filtro de parceiros recentes por função (valores derivados só da lista carregada). */
const RECENT_PARTNER_FILTER_ALL = '__all__';
const RECENT_PARTNER_FILTER_NO_ROLE = '__no_role__';

type LeilaoArtistMeta = { name: string; imageUrl: string };

const normalizeRole = (v: string | null | undefined) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export default function ConvidarColaboradorEventoScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [eventData, setEventData] = useState<any | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canInvite, setCanInvite] = useState(false);

  const [search, setSearch] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterGenero, setFilterGenero] = useState('');
  const [filterFormato, setFilterFormato] = useState('');
  const [showFilterGenero, setShowFilterGenero] = useState(false);
  const [showFilterFuncao, setShowFilterFuncao] = useState(false);
  const [showFilterFormato, setShowFilterFormato] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showFilterEstados, setShowFilterEstados] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ArtistaBuscaConvite[]>([]);
  const [blockedArtists, setBlockedArtists] = useState<Set<string>>(new Set());
  const [selectedArtist, setSelectedArtist] = useState<{
    id: string;
    name: string;
    imageUrl?: string | null;
    location?: string | null;
    musicalStyle?: string | null;
  } | null>(null);
  const [sentInvite, setSentInvite] = useState<{
    title: string;
    message: string;
    name: string;
    imageUrl: string;
    showMoreActions: boolean;
  } | null>(null);
  const [artistLocations, setArtistLocations] = useState<Record<string, string>>({});
  const [artistStyles, setArtistStyles] = useState<Record<string, string>>({});
  const [artistWorkRoles, setArtistWorkRoles] = useState<Record<string, string[]>>({});
  const [artistShowFormats, setArtistShowFormats] = useState<Record<string, string[]>>({});
  const [artistRatingSummary, setArtistRatingSummary] = useState<Record<string, ResumoAvaliacaoArtistaConvite>>({});
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [reviewsModalArtist, setReviewsModalArtist] = useState<{ id: string; name: string; imageUrl: string } | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsList, setReviewsList] = useState<AvaliacaoPublicaArtistaConvite[]>([]);

  const [recentPartners, setRecentPartners] = useState<ParceiroRecenteParticipacao[]>([]);
  const [recentPartnersLoading, setRecentPartnersLoading] = useState(true);
  const [recentPartnersError, setRecentPartnersError] = useState<string | null>(null);
  const [recentPartnerRoleFilter, setRecentPartnerRoleFilter] = useState<string>(RECENT_PARTNER_FILTER_ALL);

  const [cacheDraft, setCacheDraft] = useState('R$ 0,00');
  const [whatsDraft, setWhatsDraft] = useState('');
  const [functionDraft, setFunctionDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [inviteDisputeGroupId, setInviteDisputeGroupId] = useState(newInviteDisputeGroupId);
  const [leilaoMode, setLeilaoMode] = useState(false);
  const [leilaoSelectedIds, setLeilaoSelectedIds] = useState<string[]>([]);
  const [leilaoArtistMeta, setLeilaoArtistMeta] = useState<Record<string, LeilaoArtistMeta>>({});
  const [leilaoModalVisible, setLeilaoModalVisible] = useState(false);

  const removeLeilaoArtist = (artistId: string) => {
    setLeilaoSelectedIds((prev) => prev.filter((x) => x !== artistId));
    setLeilaoArtistMeta((prev) => {
      const next = { ...prev };
      delete next[artistId];
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventId || !activeArtist?.id) {
        setLoading(false);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id ?? null;
      if (!userId) {
        if (!cancelled) {
          setLoading(false);
          Alert.alert('Erro', 'Usuário não autenticado.');
          router.back();
        }
        return;
      }
      const eventRes = await getEventById(eventId);
      if (!eventRes.success || !eventRes.event) {
        if (!cancelled) {
          setLoading(false);
          Alert.alert('Erro', 'Evento não encontrado.');
          router.back();
        }
        return;
      }
      const event = eventRes.event;
      const { data: member } = await supabase
        .from('artist_members')
        .select('role')
        .eq('user_id', userId)
        .eq('artist_id', activeArtist.id)
        .maybeSingle();
      const canCreate = member?.role === 'admin';
      const allowed = canCreate && event.artist_id === activeArtist.id;
      const { profile: inviterProfile } = await getUserProfile(userId);
      const inviterWhats =
        inviterProfile?.phone?.trim() != null && inviterProfile.phone.trim() !== ''
          ? maskBrazilMobile(inviterProfile.phone)
          : '';
      if (!cancelled) {
        setCurrentUserId(userId);
        setCanInvite(allowed);
        setEventData(event);
        setWhatsDraft(inviterWhats);
        setLoading(false);
      }
      if (!allowed) {
        Alert.alert(
          'Acesso restrito',
          'Somente o organizador com permissão pode incluir participação de outro artista neste evento.'
        );
        router.back();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, activeArtist?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventData?.id) return;
      const { convites } = await listarConvitesDoEvento(eventData.id);
      const blocked = new Set(
        (convites || [])
          .filter((c) => c.status === 'pendente' || c.status === 'aceito')
          .map((c) => c.artista_convidado_id)
      );
      if (!cancelled) setBlockedArtists(blocked);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventData?.id]);

  useEffect(() => {
    if (!canInvite || !activeArtist?.id) return;
    let cancelled = false;
    (async () => {
      setRecentPartnersLoading(true);
      setRecentPartnersError(null);
      const { partners, error } = await listarParceirosRecentesParticipacao(activeArtist.id, 15);
      if (cancelled) return;
      setRecentPartners((partners || []).filter((p) => p.is_available_for_gigs === true));
      setRecentPartnersError(error);
      setRecentPartnersLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canInvite, activeArtist?.id]);

  useEffect(() => {
    if (!canInvite || !eventData?.artist_id) return;
    const t = setTimeout(async () => {
      if (leilaoMode && !functionDraft.trim()) {
        setSearchResults([]);
        setSearchError(null);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      setSearchError(null);
      const { artists, error } = await buscarArtistasParaConvite(search, eventData.artist_id, {
        cidade: filterCity,
        estado: filterState,
        funcao: filterRole,
        genero: filterGenero,
        formato: filterFormato,
      });
      // A RPC já devolve somente artistas com is_available_for_gigs = true.
      // Não filtrar aqui por esse campo, pois algumas versões da RPC não retornam a coluna.
      const filtered = artists.filter((a) => !blockedArtists.has(a.id));
      setSearchResults(filtered);
      setSearchError(error);
      setSearchLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [search, filterCity, filterState, filterRole, filterGenero, filterFormato, canInvite, eventData?.artist_id, blockedArtists, leilaoMode, functionDraft]);

  useEffect(() => {
    if (!leilaoMode) return;
    const fn = functionDraft.trim();
    if (!fn) return;
    if (filterRole !== fn) setFilterRole(fn);
  }, [leilaoMode, functionDraft, filterRole]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = searchResults.map((artist) => artist.id);
      if (ids.length === 0) {
        if (!cancelled) {
          setArtistLocations({});
          setArtistStyles({});
          setArtistWorkRoles({});
          setArtistShowFormats({});
        }
        return;
      }

      const { data: styleData } = await supabase
        .from('artists')
        .select('id, musical_style, work_roles, show_formats')
        .in('id', ids);
      if (!cancelled) {
        const nextStyles: Record<string, string> = {};
        const nextWorkRoles: Record<string, string[]> = {};
        const nextShowFormats: Record<string, string[]> = {};
        (
          (styleData as Array<{
            id: string;
            musical_style?: string | null;
            work_roles?: unknown;
            show_formats?: unknown;
          }> | null) || []
        ).forEach((row) => {
          const style = String(row.musical_style || '').trim();
          if (style) nextStyles[row.id] = style;
          nextWorkRoles[row.id] = parseArtistStringArrayFromJson(row.work_roles);
          nextShowFormats[row.id] = normalizeShowFormats(row.show_formats);
        });
        setArtistStyles(nextStyles);
        setArtistWorkRoles(nextWorkRoles);
        setArtistShowFormats(nextShowFormats);
      }

      const fetchCityState = async () => {
        const { data, error } = await supabase.from('artists').select('id, city, state').in('id', ids);
        if (error) return { ok: false as const, rows: [] as Array<{ id: string; value: string }> };
        const rows =
          ((data as Array<{ id: string; city?: string | null; state?: string | null }> | null) || [])
            .map((row) => {
              const city = String(row.city || '').trim();
              const state = String(row.state || '').trim().toUpperCase();
              const value = city && state ? `${city}/${state}` : city || state;
              return { id: row.id, value };
            })
            .filter((row) => row.value.length > 0);
        return { ok: true as const, rows };
      };

      const fetchByColumn = async (column: 'city' | 'location') => {
        const { data, error } = await supabase.from('artists').select(`id, ${column}`).in('id', ids);
        if (error) return { ok: false as const, rows: [] as Array<{ id: string; value: string }> };
        const rows =
          ((data as Array<{ id: string; city?: string | null; location?: string | null }> | null) || [])
            .map((row) => ({
              id: row.id,
              value: String((column === 'city' ? row.city : row.location) || '').trim(),
            }))
            .filter((row) => row.value.length > 0);
        return { ok: true as const, rows };
      };

      const fetchFromMembersUserProfile = async () => {
        const { data, error } = await supabase
          .from('artist_members')
          .select('artist_id, role, users(city, state)')
          .in('artist_id', ids);
        if (error) return { ok: false as const, rows: [] as Array<{ id: string; value: string }> };

        const rolePriority: Record<string, number> = { admin: 1, vendedor: 2, viewer: 3 };
        const byArtist = new Map<string, { priority: number; value: string }>();

        (
          (data as Array<{
            artist_id: string;
            role?: string | null;
            users?: { city?: string | null; state?: string | null } | null;
          }> | null) || []
        ).forEach((row) => {
          const city = String(row.users?.city || '').trim();
          const state = String(row.users?.state || '').trim().toUpperCase();
          const value = city && state ? `${city}/${state}` : city || state;
          if (!value) return;

          const priority = rolePriority[String(row.role || '').toLowerCase()] ?? 99;
          const current = byArtist.get(row.artist_id);
          if (!current || priority < current.priority) {
            byArtist.set(row.artist_id, { priority, value });
          }
        });

        const rows = Array.from(byArtist.entries()).map(([id, meta]) => ({ id, value: meta.value }));
        return { ok: true as const, rows };
      };

      let result = await fetchCityState();
      if (!result.ok) result = await fetchByColumn('city');
      if (!result.ok) result = await fetchByColumn('location');
      if (!result.ok || result.rows.length === 0) result = await fetchFromMembersUserProfile();

      if (cancelled) return;
      const next: Record<string, string> = {};
      result.rows.forEach((row) => {
        next[row.id] = row.value;
      });
      setArtistLocations(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchResults]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = [...new Set([...searchResults.map((a) => a.id), ...recentPartners.map((a) => a.id)])];
      if (ids.length === 0) {
        if (!cancelled) setArtistRatingSummary({});
        return;
      }
      const { resumo } = await listarResumoAvaliacoesArtistasParaConvite(ids);
      if (cancelled) return;
      const map: Record<string, ResumoAvaliacaoArtistaConvite> = {};
      for (const row of resumo) {
        map[row.artista_avaliado_id] = row;
      }
      setArtistRatingSummary(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchResults, recentPartners]);

  const selectedLabel = useMemo(() => selectedArtist?.name || 'Nenhum', [selectedArtist]);
  const selectedSearchRow = useMemo(() => {
    if (!selectedArtist) return undefined;
    return (
      searchResults.find((a) => a.id === selectedArtist.id) ??
      recentPartners.find((a) => a.id === selectedArtist.id)
    );
  }, [searchResults, selectedArtist, recentPartners]);
  const activeFiltersCount = useMemo(
    () =>
      [filterCity, filterState, filterRole, filterGenero, filterFormato].filter(
        (s) => String(s || '').trim().length >= 2
      ).length,
    [filterCity, filterState, filterRole, filterGenero, filterFormato]
  );

  const recentPartnerRoleBuckets = useMemo(() => {
    const roles = new Set<string>();
    let semFuncao = false;
    for (const p of recentPartners) {
      const f = (p.ultima_funcao || '').trim();
      if (!f) semFuncao = true;
      else roles.add(f);
    }
    const lista = [...roles].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const categorias = lista.length + (semFuncao ? 1 : 0);
    return { lista, semFuncao, categorias, mostrarFiltro: recentPartners.length > 0 && categorias > 1 };
  }, [recentPartners]);

  const recentPartnersFiltrados = useMemo(() => {
    if (recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL) return recentPartners;
    if (recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE) {
      return recentPartners.filter((p) => !(p.ultima_funcao || '').trim());
    }
    return recentPartners.filter((p) => (p.ultima_funcao || '').trim() === recentPartnerRoleFilter);
  }, [recentPartners, recentPartnerRoleFilter]);

  useEffect(() => {
    const roles = new Set<string>();
    let semFuncao = false;
    for (const p of recentPartners) {
      const f = (p.ultima_funcao || '').trim();
      if (!f) semFuncao = true;
      else roles.add(f);
    }
    if (recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL) return;
    if (recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE) {
      if (!semFuncao) setRecentPartnerRoleFilter(RECENT_PARTNER_FILTER_ALL);
      return;
    }
    if (!roles.has(recentPartnerRoleFilter)) setRecentPartnerRoleFilter(RECENT_PARTNER_FILTER_ALL);
  }, [recentPartnerRoleFilter, recentPartners]);

  const locationLine = (item: ArtistaBuscaConvite, fallback: string) => {
    const c = (item.city ?? '').trim();
    const s = (item.state ?? '').trim();
    if (c && s) return `${c} / ${s.toUpperCase()}`;
    if (c) return c;
    if (s) return s.toUpperCase();
    return fallback;
  };

  /** Uma linha curta para o card (evita quebra no meio do mês). */
  const formatDataShowCompact = (yyyyMmDd: string | null | undefined) => {
    if (!yyyyMmDd) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(yyyyMmDd).trim());
    if (!m) return String(yyyyMmDd).slice(0, 10);
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  };

  /** Valor em uma linha; NBSP entre R$ e número para não partir "R$" / valor. */
  const formatCacheUmaLinha = (valor: number | null | undefined) => {
    if (valor == null || !Number.isFinite(valor) || valor <= 0) return '—';
    const part = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R$\u00A0${part}`;
  };

  const whatsAppDisplay = (raw: string | null | undefined) => {
    const digits = brazilMobileDigits(String(raw ?? ''));
    if (digits.length < 10) return null;
    return maskBrazilMobile(digits);
  };

  const formatReviewDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR');
  };

  const openReviewsModal = async (artist: { id: string; name: string; imageUrl: string }) => {
    setReviewsModalArtist(artist);
    setShowReviewsModal(true);
    setReviewsLoading(true);
    setReviewsError(null);
    const { avaliacoes, error } = await listarAvaliacoesPublicasArtistaParaConvite(artist.id, 40);
    setReviewsLoading(false);
    if (error) {
      setReviewsError(error);
      setReviewsList([]);
      return;
    }
    setReviewsList(avaliacoes);
  };

  const renderArtistCard = ({ item }: { item: ArtistaBuscaConvite }) => {
    const inLeilaoSel = leilaoSelectedIds.includes(item.id);
    const isSelected = leilaoMode ? inLeilaoSel : selectedArtist?.id === item.id;
    const artistLocation = locationLine(item, artistLocations[item.id] || 'Não informado');
    const artistStyle = (item.musical_style || artistStyles[item.id] || '').trim();
    const rolesFromRpc = parseArtistStringArrayFromJson(item.work_roles);
    const formatsFromRpc = normalizeShowFormats(item.show_formats);
    const roles = rolesFromRpc.length > 0 ? rolesFromRpc : artistWorkRoles[item.id] || [];
    const selectedFunctionNormalized = normalizeRole(functionDraft);
    const artistMatchesLeilaoFunction =
      selectedFunctionNormalized.length > 0 &&
      roles.some((r) => normalizeRole(r) === selectedFunctionNormalized);
    const requiresFunctionForLeilao = leilaoMode && selectedFunctionNormalized.length === 0;
    const blockedByFunction = leilaoMode && selectedFunctionNormalized.length > 0 && !artistMatchesLeilaoFunction;
    const formats = formatsFromRpc.length > 0 ? formatsFromRpc : artistShowFormats[item.id] || [];
    const whatsShown = item.show_whatsapp === true ? whatsAppDisplay(item.whatsapp) : null;
    const locDisplay = artistLocation.trim() || 'Local não informado';
    const rating = artistRatingSummary[item.id];
    const ratingAvg = rating?.media_nota_geral ?? null;
    const ratingTotal = rating?.total_avaliacoes ?? 0;
    const ratingComment = rating?.comentario_publico_recente ?? null;
    return (
      <TouchableOpacity
        style={[
          styles.rowCard,
          {
            borderColor: isSelected ? `${colors.primary}66` : colors.border,
            backgroundColor: isSelected ? `${colors.primary}12` : colors.surface,
          },
        ]}
        onPress={() => {
          Keyboard.dismiss();
          if (leilaoMode) {
            if (requiresFunctionForLeilao) {
              Alert.alert('Função obrigatória', 'No leilão, selecione a função antes de escolher os artistas.');
              return;
            }
            if (blockedByFunction) {
              Alert.alert('Função incompatível', `Este artista não está marcado com a função "${functionDraft.trim()}".`);
              return;
            }
            if (blockedArtists.has(item.id)) {
              Alert.alert(
                'Já neste evento',
                'Já existe convite pendente ou aceito para este artista neste evento.'
              );
              return;
            }
            setLeilaoSelectedIds((prev) => {
              if (prev.includes(item.id)) {
                setLeilaoArtistMeta((m) => {
                  const n = { ...m };
                  delete n[item.id];
                  return n;
                });
                return prev.filter((x) => x !== item.id);
              }
              setLeilaoArtistMeta((m) => ({
                ...m,
                [item.id]: {
                  name: (item.name || 'Artista').trim(),
                  imageUrl: item.image_url ?? item.profile_url ?? '',
                },
              }));
              return [...prev, item.id];
            });
            return;
          }
          setSelectedArtist({
            id: item.id,
            name: item.name,
            imageUrl: item.image_url ?? item.profile_url ?? '',
            location: locDisplay,
            musicalStyle: artistStyle || null,
          });
          setFunctionDraft('');
          setMessageDraft('');
          setInviteModalVisible(true);
        }}
        activeOpacity={0.75}
      >
        <View style={styles.rowCardInner}>
          <OptimizedImage
            imageUrl={item.image_url ?? item.profile_url ?? ''}
            style={styles.rowAvatarMd}
            fallbackText={item.name || 'Artista'}
            fallbackIcon="person"
            fallbackIconSize={18}
            fallbackIconColor={colors.primary}
            showLoadingIndicator={false}
          />
          <View style={styles.rowCardInfo}>
            <View style={styles.rowCardHeader}>
              <Text
                style={[styles.artistNameCard, { color: colors.text, fontWeight: isSelected ? '800' : '700' }]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              {isSelected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </View>

            {ratingAvg != null && ratingTotal > 0 ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() =>
                  void openReviewsModal({
                    id: item.id,
                    name: item.name,
                    imageUrl: item.image_url ?? item.profile_url ?? '',
                  })
                }
                style={[styles.ratingCardInline, { backgroundColor: `${colors.warning}14`, borderColor: `${colors.warning}55` }]}
              >
                <View style={styles.ratingInlineTop}>
                  <View style={styles.ratingInlineStars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons
                        key={`${item.id}-star-${n}`}
                        name={n <= Math.round(ratingAvg) ? 'star' : 'star-outline'}
                        size={12}
                        color="#F59E0B"
                      />
                    ))}
                  </View>
                  <Text style={[styles.ratingInlineValue, { color: colors.text }]}>
                    {ratingAvg.toFixed(1)} ({ratingTotal})
                  </Text>
                </View>
                {ratingComment ? (
                  <Text style={[styles.ratingInlineComment, { color: colors.textSecondary }]} numberOfLines={2}>
                    "{ratingComment}"
                  </Text>
                ) : null}
                <Text style={[styles.ratingInlineAction, { color: colors.primary }]}>Ver avaliações</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.ratingInlineEmpty, { color: colors.textSecondary }]}>Sem avaliações ainda</Text>
            )}

            {(!!artistStyle || whatsShown != null) && (
              <View style={styles.cardBlockTop}>
                <View style={styles.metaChipsRow}>
                  {!!artistStyle && (
                    <Text
                      style={[styles.stylePill, { color: colors.primary, backgroundColor: `${colors.primary}14` }]}
                      numberOfLines={1}
                    >
                      {artistStyle}
                    </Text>
                  )}
                  {whatsShown != null && (
                    <View
                      style={[
                        styles.whatsTag,
                        {
                          backgroundColor: `${colors.success}18`,
                          borderColor: `${colors.success}50`,
                        },
                      ]}
                    >
                      <Ionicons name="logo-whatsapp" size={12} color={colors.success} />
                      <Text style={[styles.whatsTagText, { color: colors.success }]}>WhatsApp</Text>
                    </View>
                  )}
                </View>
                {whatsShown != null && (
                  <View style={styles.whatsContactRow}>
                    <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.whatsContactText, { color: colors.text }]} numberOfLines={1}>
                      {whatsShown}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {roles.length > 0 && (
              <View style={styles.cardBlockSection}>
                <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Funções</Text>
                <View style={styles.rolesWrap}>
                  {roles.map((role) => (
                    <View
                      key={`${item.id}-role-${role}`}
                      style={[styles.roleChip, { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}44` }]}
                    >
                      <Text style={[styles.roleChipText, { color: colors.primary }]} numberOfLines={1}>
                        {role}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {formats.length > 0 && (
              <View style={styles.cardBlockSection}>
                <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Como se apresenta</Text>
                <View style={styles.rolesWrap}>
                  {formats.map((fmt) => (
                    <View
                      key={`${item.id}-fmt-${fmt}`}
                      style={[
                        styles.formatChip,
                        {
                          backgroundColor: `${colors.textSecondary}14`,
                          borderColor: `${colors.textSecondary}40`,
                        },
                      ]}
                    >
                      <Text style={[styles.formatChipText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {fmt}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={[styles.cardBlockFooter, { borderTopColor: colors.border }]}>
              {blockedByFunction ? (
                <View style={[styles.recentBadge, { backgroundColor: `${colors.warning}22`, marginBottom: 6 }]}>
                  <Text style={[styles.recentBadgeText, { color: colors.warning }]}>
                    Não corresponde à função do leilão
                  </Text>
                </View>
              ) : null}
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.locationText, { color: colors.textSecondary }]}>{locDisplay}</Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderRecentPartnerCard = (p: ParceiroRecenteParticipacao) => {
    const isBlocked = blockedArtists.has(p.id);
    const inLeilaoSel = leilaoSelectedIds.includes(p.id);
    const locDisplay = locationLine(p, 'Local não informado');
    const artistStyle = (p.musical_style || '').trim();
    const dataShowLabel = formatDataShowCompact(p.participacao_data_evento);
    const selectedFunctionNormalized = normalizeRole(functionDraft);
    const recentRoleNormalized = normalizeRole(p.ultima_funcao);
    const requiresFunctionForLeilao = leilaoMode && selectedFunctionNormalized.length === 0;
    const blockedByFunction =
      leilaoMode && selectedFunctionNormalized.length > 0 && recentRoleNormalized !== selectedFunctionNormalized;
    const rating = artistRatingSummary[p.id];
    const ratingAvg = rating?.media_nota_geral ?? null;
    const ratingTotal = rating?.total_avaliacoes ?? 0;
    return (
      <TouchableOpacity
        style={[
          styles.recentCard,
          {
            borderColor:
              leilaoMode && inLeilaoSel
                ? colors.primary
                : isBlocked
                  ? colors.border
                  : `${colors.primary}44`,
            backgroundColor: isBlocked ? `${colors.textSecondary}0c` : colors.surface,
            opacity: isBlocked ? 0.72 : 1,
          },
        ]}
        onPress={() => {
          if (isBlocked) {
            Alert.alert(
              'Já neste evento',
              'Já existe convite pendente ou aceito para este artista neste evento.'
            );
            return;
          }
          Keyboard.dismiss();
          if (leilaoMode) {
            if (requiresFunctionForLeilao) {
              Alert.alert('Função obrigatória', 'No leilão, selecione a função antes de escolher os artistas.');
              return;
            }
            if (blockedByFunction) {
              Alert.alert(
                'Função incompatível',
                `Este parceiro recente não está com a função "${functionDraft.trim()}" no último convite.`
              );
              return;
            }
            setLeilaoSelectedIds((prev) => {
              if (prev.includes(p.id)) {
                setLeilaoArtistMeta((m) => {
                  const n = { ...m };
                  delete n[p.id];
                  return n;
                });
                return prev.filter((x) => x !== p.id);
              }
              setLeilaoArtistMeta((m) => ({
                ...m,
                [p.id]: {
                  name: (p.name || 'Artista').trim(),
                  imageUrl: p.image_url ?? p.profile_url ?? '',
                },
              }));
              return [...prev, p.id];
            });
            return;
          }
          setSelectedArtist({
            id: p.id,
            name: p.name,
            imageUrl: p.image_url ?? p.profile_url ?? '',
            location: locDisplay,
            musicalStyle: artistStyle || null,
          });
          setFunctionDraft(p.ultima_funcao?.trim() || '');
          const cacheNum = p.ultimo_cache_valor;
          if (cacheNum != null && Number.isFinite(cacheNum) && cacheNum > 0) {
            setCacheDraft(formatCurrencyBRLFromAmount(cacheNum));
          } else {
            setCacheDraft('R$ 0,00');
          }
          setMessageDraft('');
          setInviteModalVisible(true);
        }}
        activeOpacity={0.75}
      >
        <View style={styles.recentCardTop}>
          <OptimizedImage
            imageUrl={p.image_url ?? p.profile_url ?? ''}
            style={styles.recentAvatar}
            fallbackText={p.name || 'Artista'}
            fallbackIcon="person"
            fallbackIconSize={14}
            fallbackIconColor={colors.primary}
            showLoadingIndicator={false}
          />
          <Text style={[styles.recentName, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
            {p.name}
          </Text>
        </View>

        <Text style={[styles.recentMetaLine, { color: colors.textSecondary }]} numberOfLines={1}>
          {dataShowLabel || '—'} · {p.ultima_funcao?.trim() || '—'}
        </Text>

        <Text style={styles.recentCacheLine}>
          <Text style={[styles.recentCacheLineMuted, { color: colors.textSecondary }]}>Cachê </Text>
          <Text style={[styles.recentCacheLineValue, { color: colors.primary }]}>{formatCacheUmaLinha(p.ultimo_cache_valor)}</Text>
        </Text>

        {ratingAvg != null && ratingTotal > 0 ? (
          <TouchableOpacity
            onPress={() =>
              void openReviewsModal({
                id: p.id,
                name: p.name,
                imageUrl: p.image_url ?? p.profile_url ?? '',
              })
            }
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
          >
            <Text style={[styles.recentRatingCompact, { color: colors.textSecondary }]}>
              {'⭐'.repeat(Math.max(1, Math.min(5, Math.round(ratingAvg))))}{' '}
              <Text style={{ color: colors.text, fontWeight: '700' }}>{ratingAvg.toFixed(1)}</Text>
              {' · '}
              {ratingTotal} {ratingTotal === 1 ? 'avaliação' : 'avaliações'}
              {' · '}
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Ver avaliações</Text>
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.recentBadges}>
          {blockedByFunction ? (
            <View style={[styles.recentBadge, { backgroundColor: `${colors.warning}22` }]}>
              <Text style={[styles.recentBadgeText, { color: colors.warning }]}>Função diferente</Text>
            </View>
          ) : null}
          {isBlocked ? (
            <View style={[styles.recentBadge, { backgroundColor: `${colors.textSecondary}22` }]}>
              <Text style={[styles.recentBadgeText, { color: colors.textSecondary }]}>Neste evento</Text>
            </View>
          ) : null}
          {!p.is_available_for_gigs ? (
            <View style={[styles.recentBadge, { backgroundColor: `${colors.warning}22` }]}>
              <Text style={[styles.recentBadgeText, { color: colors.warning }]}>Sem busca pública</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const handleSubmit = async () => {
    if (!eventData || !activeArtist || !currentUserId || !selectedArtist) return;
    const cacheDigits = extractNumericValueString(cacheDraft);
    const cacheNumerico = cacheDigits ? Number(cacheDigits) : NaN;
    if (!cacheDraft.trim() || Number.isNaN(cacheNumerico) || cacheNumerico <= 0) {
      Alert.alert('Cachê obrigatório', 'Informe um valor de cachê válido para enviar o convite.');
      return;
    }
    if (!functionDraft.trim()) {
      Alert.alert('Função obrigatória', 'Informe a função do participante.');
      return;
    }
    const whatsDigits = brazilMobileDigits(whatsDraft);
    if (whatsDigits.length > 0 && whatsDigits.length !== 11) {
      Alert.alert('WhatsApp incompleto', 'Informe (XX) XXXXX-XXXX ou deixe vazio.');
      return;
    }
    setSending(true);
    const { success, error } = await enviarConviteParticipacao({
      eventoOrigemId: eventData.id,
      artistaQueConvidaId: activeArtist.id,
      artistaConvidadoId: selectedArtist.id,
      usuarioQueEnviaId: currentUserId,
      mensagem: messageDraft.trim() || null,
      funcaoParticipacao: functionDraft.trim(),
      nomeEvento: eventData.name,
      dataEvento: eventData.event_date,
      horaInicio: eventData.start_time,
      horaFim: eventData.end_time,
      cacheValor: cacheNumerico,
      cidade: eventData.city ?? null,
      telefoneContratante: whatsDigits.length === 11 ? maskBrazilMobile(whatsDraft) : null,
      descricao: eventData.description ?? null,
      grupoDisputaId: inviteDisputeGroupId,
    });
    setSending(false);
    if (!success) {
      Alert.alert('Erro', error || 'Não foi possível enviar o convite.');
      return;
    }
    setInviteModalVisible(false);
    setSentInvite({
      title: 'Convite enviado',
      message: 'O artista recebe o aviso no app e pode aceitar ou recusar.',
      name: selectedArtist.name,
      imageUrl: selectedArtist.imageUrl || '',
      showMoreActions: true,
    });
  };

  const handleLeilaoSubmit = async () => {
    if (!eventData || !activeArtist || !currentUserId || leilaoSelectedIds.length === 0) return;
    const cacheDigits = extractNumericValueString(cacheDraft);
    const cacheNumerico = cacheDigits ? Number(cacheDigits) : NaN;
    if (!cacheDraft.trim() || Number.isNaN(cacheNumerico) || cacheNumerico <= 0) {
      Alert.alert('Cachê obrigatório', 'Informe um valor de cachê válido.');
      return;
    }
    if (!functionDraft.trim()) {
      Alert.alert('Função obrigatória', 'Informe a função do participante.');
      return;
    }
    const whatsDigits = brazilMobileDigits(whatsDraft);
    if (whatsDigits.length > 0 && whatsDigits.length !== 11) {
      Alert.alert('WhatsApp incompleto', 'Informe (XX) XXXXX-XXXX ou deixe vazio.');
      return;
    }
    setSending(true);
    const { ok, error, resultados } = await enviarConvitesParticipacaoLeilaoLote({
      eventoOrigemId: eventData.id,
      artistaQueConvidaId: activeArtist.id,
      usuarioQueEnviaId: currentUserId,
      artistaConvidadoIds: leilaoSelectedIds,
      funcaoParticipacao: functionDraft.trim(),
      mensagem: messageDraft.trim() || null,
      nomeEvento: eventData.name,
      dataEvento: eventData.event_date,
      horaInicio: eventData.start_time,
      horaFim: eventData.end_time,
      cacheValor: cacheNumerico,
      cidade: eventData.city ?? null,
      telefoneContratante: whatsDigits.length === 11 ? maskBrazilMobile(whatsDraft) : null,
      descricao: eventData.description ?? null,
    });
    setSending(false);
    if (!ok) {
      Alert.alert('Leilão', error || 'Não foi possível enviar os convites.');
      return;
    }
    const okN = resultados.filter((r) => r.success).length;
    const failN = resultados.length - okN;
    const { convites } = await listarConvitesDoEvento(eventData.id);
    const blocked = new Set(
      (convites || [])
        .filter((c) => c.status === 'pendente' || c.status === 'aceito')
        .map((c) => c.artista_convidado_id)
    );
    setBlockedArtists(blocked);
    setLeilaoModalVisible(false);
    setLeilaoSelectedIds([]);
    setLeilaoArtistMeta({});
    setLeilaoMode(false);
    setSentInvite({
      title: 'Convites enviados',
      message:
        failN > 0
          ? `${okN} convite(s) enviado(s). ${failN} não puderam ser enviados.`
          : `${okN} convite(s) enviado(s) na mesma rodada. O primeiro que aceitar fica com a vaga.`,
      name: okN === 1 ? '1 artista' : `${okN} artistas`,
      imageUrl: '',
      showMoreActions: false,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Participação de outro artista</Text>
          {canInvite ? (
            <TouchableOpacity
              onPress={() => {
                setLeilaoMode((m) => {
                  const next = !m;
                  if (!next) {
                    setLeilaoSelectedIds([]);
                    setLeilaoArtistMeta({});
                    setLeilaoModalVisible(false);
                  }
                  setSelectedArtist(null);
                  setInviteModalVisible(false);
                  return next;
                });
              }}
              style={styles.headerLeilaoBtn}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Ionicons
                name="flash-outline"
                size={18}
                color={leilaoMode ? colors.primary : colors.textSecondary}
              />
              <Text
                style={{
                  marginLeft: 4,
                  color: leilaoMode ? colors.primary : colors.textSecondary,
                  fontWeight: '800',
                  fontSize: 13,
                }}
              >
                Leilão
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
        </View>

        <View style={styles.flex1}>
          <FlatList
            style={styles.resultsList}
            data={search.trim().length < 2 ? [] : searchResults}
            keyExtractor={(item) => item.id}
            extraData={{
              sid: selectedArtist?.id,
              blk: [...blockedArtists].sort().join(','),
              rec: recentPartners.length,
              rLoad: recentPartnersLoading,
              rFil: recentPartnerRoleFilter,
              rFilt: recentPartnersFiltrados.length,
              leilao: leilaoMode,
              lsel: leilaoSelectedIds.join(','),
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.resultsListContent,
              canInvite && leilaoMode && leilaoSelectedIds.length > 0 ? { paddingBottom: 100 } : null,
            ]}
            ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
            ListHeaderComponent={
              <View>
                {canInvite && leilaoMode ? (
                  <View
                    style={[
                      styles.leilaoHintBanner,
                      { backgroundColor: `${colors.primary}14`, borderBottomColor: colors.border },
                    ]}
                  >
                    <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
                    <Text style={[styles.leilaoHintText, { color: colors.text }]}>
                      Primeiro selecione a função do leilão. Depois toque nos artistas para marcar ou desmarcar. O primeiro
                      que aceitar mantém a vaga e os demais da rodada são cancelados.
                    </Text>
                  </View>
                ) : null}
                {canInvite && leilaoMode ? (
                  <View style={[styles.leilaoFunctionSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.filterFieldLabel, { color: colors.text }]}>Função do leilão (obrigatória)</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.funcPresetRow}
                      keyboardShouldPersistTaps="handled"
                    >
                      {ARTIST_WORK_ROLE_PRESETS.map((role) => {
                        const selected = functionDraft.trim() === role;
                        return (
                          <TouchableOpacity
                            key={`leilao-search-func-${role}`}
                            onPress={() => {
                              setFunctionDraft(role);
                              setFilterRole(role);
                              setLeilaoSelectedIds([]);
                              setLeilaoArtistMeta({});
                            }}
                            activeOpacity={0.75}
                            style={[
                              styles.funcPresetChip,
                              {
                                borderColor: selected ? colors.primary : colors.border,
                                backgroundColor: selected ? `${colors.primary}16` : colors.background,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.funcPresetChipText,
                                { color: selected ? colors.primary : colors.text, fontWeight: selected ? '800' : '600' },
                              ]}
                              numberOfLines={1}
                            >
                              {role}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <TextInput
                      style={[styles.filterInput, styles.filterInputLast, { color: colors.text, borderColor: colors.border }]}
                      placeholder="Ou digite a função (ex.: sanfoneiro)"
                      placeholderTextColor={colors.textSecondary}
                      value={functionDraft}
                      onChangeText={(text) => {
                        setFunctionDraft(text);
                        setFilterRole(text);
                        setLeilaoSelectedIds([]);
                        setLeilaoArtistMeta({});
                      }}
                    />
                  </View>
                ) : null}
                {canInvite ? (
                  <View style={[styles.recentSection, { borderBottomColor: colors.border }]}>
                    <View style={styles.recentSectionInner}>
                      <Text style={[styles.sectionTitle, { color: colors.text }]}>Parceiros recentes</Text>
                      <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                        {leilaoMode
                          ? 'No modo leilão, toque para marcar quem entra na mesma rodada de convites.'
                          : 'Quem já aceitou participar em algum show seu — toque para enviar um novo convite.'}
                      </Text>
                      {recentPartnersLoading ? (
                        <View style={styles.recentLoadingRow}>
                          <ActivityIndicator color={colors.primary} />
                        </View>
                      ) : recentPartnersError ? (
                        <Text style={[styles.recentErrorText, { color: colors.error }]}>{recentPartnersError}</Text>
                      ) : recentPartners.length === 0 ? (
                        <Text style={[styles.sectionHint, { color: colors.textSecondary, marginBottom: 0 }]}>
                          Nenhum ainda. Quando alguém aceitar um convite de participação, aparece aqui.
                        </Text>
                      ) : (
                        <>
                          {recentPartnerRoleBuckets.mostrarFiltro ? (
                            <View style={styles.recentFilterBlock}>
                              <Text style={[styles.recentFilterTitle, { color: colors.textSecondary }]}>
                                Filtrar por função
                              </Text>
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.recentFilterChipsRow}
                                keyboardShouldPersistTaps="handled"
                              >
                                <TouchableOpacity
                                  onPress={() => setRecentPartnerRoleFilter(RECENT_PARTNER_FILTER_ALL)}
                                  style={[
                                    styles.recentFilterChip,
                                    {
                                      borderColor:
                                        recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL
                                          ? colors.primary
                                          : colors.border,
                                      backgroundColor:
                                        recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL
                                          ? `${colors.primary}18`
                                          : colors.background,
                                    },
                                  ]}
                                  activeOpacity={0.75}
                                >
                                  <Text
                                    style={[
                                      styles.recentFilterChipText,
                                      {
                                        color:
                                          recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL
                                            ? colors.primary
                                            : colors.text,
                                        fontWeight: recentPartnerRoleFilter === RECENT_PARTNER_FILTER_ALL ? '800' : '600',
                                      },
                                    ]}
                                  >
                                    Todos
                                  </Text>
                                </TouchableOpacity>
                                {recentPartnerRoleBuckets.semFuncao ? (
                                  <TouchableOpacity
                                    onPress={() => setRecentPartnerRoleFilter(RECENT_PARTNER_FILTER_NO_ROLE)}
                                    style={[
                                      styles.recentFilterChip,
                                      {
                                        borderColor:
                                          recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE
                                            ? colors.primary
                                            : colors.border,
                                        backgroundColor:
                                          recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE
                                            ? `${colors.primary}18`
                                            : colors.background,
                                      },
                                    ]}
                                    activeOpacity={0.75}
                                  >
                                    <Text
                                      style={[
                                        styles.recentFilterChipText,
                                        {
                                          color:
                                            recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE
                                              ? colors.primary
                                              : colors.text,
                                          fontWeight:
                                            recentPartnerRoleFilter === RECENT_PARTNER_FILTER_NO_ROLE ? '800' : '600',
                                        },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      Sem função
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                                {recentPartnerRoleBuckets.lista.map((role) => (
                                  <TouchableOpacity
                                    key={`recent-filter-${role}`}
                                    onPress={() => setRecentPartnerRoleFilter(role)}
                                    style={[
                                      styles.recentFilterChip,
                                      {
                                        maxWidth: 200,
                                        borderColor:
                                          recentPartnerRoleFilter === role ? colors.primary : colors.border,
                                        backgroundColor:
                                          recentPartnerRoleFilter === role ? `${colors.primary}18` : colors.background,
                                      },
                                    ]}
                                    activeOpacity={0.75}
                                  >
                                    <Text
                                      style={[
                                        styles.recentFilterChipText,
                                        {
                                          color: recentPartnerRoleFilter === role ? colors.primary : colors.text,
                                          fontWeight: recentPartnerRoleFilter === role ? '800' : '600',
                                        },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {role}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                          {recentPartnersFiltrados.length === 0 ? (
                            <Text style={[styles.sectionHint, { color: colors.textSecondary, marginBottom: 4 }]}>
                              Nenhum parceiro com essa função.
                            </Text>
                          ) : null}
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.recentScrollContent}
                            keyboardShouldPersistTaps="handled"
                          >
                            {recentPartnersFiltrados.map((p) => (
                              <React.Fragment key={p.id}>{renderRecentPartnerCard(p)}</React.Fragment>
                            ))}
                          </ScrollView>
                        </>
                      )}
                    </View>
                  </View>
                ) : null}

                <View style={styles.searchSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Quem convidar</Text>
                  <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                    Digite pelo menos 2 letras, use os filtros se quiser e toque em um artista para preencher o convite.
                  </Text>
                  <TextInput
                    style={[
                      styles.searchInput,
                      { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                    ]}
                    placeholder="Nome do artista..."
                    placeholderTextColor={colors.textSecondary}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                  />

                  <TouchableOpacity
                    style={[styles.filterBar, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    onPress={() =>
                      setFiltersOpen((o) => {
                        const next = !o;
                        if (!next) setShowFilterEstados(false);
                        return next;
                      })
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.filterBarLeft}>
                      <Ionicons name="options-outline" size={20} color={colors.primary} />
                      <Text style={[styles.filterBarText, { color: colors.text }]}>Filtros</Text>
                      {activeFiltersCount > 0 && (
                        <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                          <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {filtersOpen && (
                    <View style={[styles.filterPanel, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <TextInput
                        style={[styles.filterInput, { color: colors.text, borderColor: colors.border }]}
                        placeholder="Cidade (opcional)"
                        placeholderTextColor={colors.textSecondary}
                        value={filterCity}
                        onChangeText={setFilterCity}
                      />
                      <Text style={[styles.filterFieldLabel, { color: colors.text }]}>Estado (opcional)</Text>
                      <TouchableOpacity
                        style={[
                          styles.estadoSelector,
                          { borderColor: colors.border, backgroundColor: colors.background },
                        ]}
                        onPress={() => setShowFilterEstados(!showFilterEstados)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.estadoText, { color: filterState ? colors.text : colors.textSecondary }]}>
                          {filterState || 'Selecione o estado'}
                        </Text>
                        <Ionicons
                          name={showFilterEstados ? 'chevron-up' : 'chevron-down'}
                          size={20}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>
                      {showFilterEstados && (
                        <View style={[styles.estadosList, { backgroundColor: colors.background, borderColor: colors.border }]}>
                          <ScrollView style={styles.estadosScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                            <TouchableOpacity
                              style={[styles.estadoItem, { borderBottomColor: colors.border }]}
                              onPress={() => {
                                setFilterState('');
                                setShowFilterEstados(false);
                              }}
                            >
                              <Text style={[styles.estadoItemText, { color: colors.textSecondary }]}>Todos os estados</Text>
                            </TouchableOpacity>
                            {ESTADOS_BRASIL.map((estadoItem) => (
                              <TouchableOpacity
                                key={estadoItem}
                                style={[styles.estadoItem, { borderBottomColor: colors.border }]}
                                onPress={() => {
                                  setFilterState(estadoItem);
                                  setShowFilterEstados(false);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.estadoItemText,
                                    { color: filterState === estadoItem ? colors.primary : colors.text },
                                  ]}
                                >
                                  {estadoItem}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                      <Text style={[styles.filterFieldLabel, { color: colors.text, marginTop: 10 }]}>
                        Gênero, função e formato
                      </Text>
                      <View style={{ gap: 8, marginBottom: 4 }}>
                        <FeedFuncaoFieldButton
                          selectedFuncao={filterGenero}
                          onPress={() => setShowFilterGenero(true)}
                          colors={colors}
                          emptyLabel="Todos os gêneros"
                          icon="musical-notes-outline"
                        />
                        <FeedFuncaoFieldButton
                          selectedFuncao={filterRole}
                          onPress={() => setShowFilterFuncao(true)}
                          colors={colors}
                          emptyLabel="Todas as funções"
                          icon="mic-outline"
                        />
                        <FeedFuncaoFieldButton
                          selectedFuncao={filterFormato}
                          onPress={() => setShowFilterFormato(true)}
                          colors={colors}
                          emptyLabel="Todos os formatos"
                          icon="people-outline"
                        />
                      </View>
                    </View>
                  )}
                </View>
                <View style={styles.listSectionHeader}>
                  <Text style={[styles.subLabel, { color: colors.textSecondary }]}>Artistas</Text>
                  {searchLoading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
                </View>
              </View>
            }
            ListEmptyComponent={
              searchLoading && search.trim().length >= 2 ? (
                <View style={styles.listEmptyLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <Text style={[styles.emptyResults, { color: searchError ? colors.error : colors.textSecondary }]}>
                  {searchError ||
                    (search.trim().length < 2 ? 'Digite pelo menos 2 letras para buscar.' : 'Nenhum artista encontrado.')}
                </Text>
              )
            }
            renderItem={renderArtistCard}
          />
        </View>
        {canInvite && leilaoMode && leilaoSelectedIds.length > 0 ? (
          <View style={[styles.leilaoBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <Text style={[styles.leilaoBarText, { color: colors.text }]}>
              {leilaoSelectedIds.length} selecionado(s)
            </Text>
            <TouchableOpacity
              style={[styles.leilaoBarBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Keyboard.dismiss();
                if (!functionDraft.trim()) {
                  Alert.alert('Função obrigatória', 'Selecione a função do leilão antes de preparar o envio.');
                  return;
                }
                setLeilaoModalVisible(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.leilaoBarBtnText}>Preparar leilão</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Modal
        visible={showReviewsModal}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowReviewsModal(false)}
      >
        <SafeAreaView style={[styles.inviteModalRoot, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowReviewsModal(false)} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Avaliações</Text>
            <View style={styles.modalCloseBtn} />
          </View>
          <View style={styles.reviewsHeader}>
            <OptimizedImage
              imageUrl={reviewsModalArtist?.imageUrl || ''}
              style={styles.reviewsHeaderAvatar}
              fallbackText={reviewsModalArtist?.name || 'Artista'}
              fallbackIcon="person"
              fallbackIconSize={14}
              fallbackIconColor={colors.primary}
              showLoadingIndicator={false}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.reviewsHeaderTitle, { color: colors.text }]}>
                {reviewsModalArtist?.name || 'Artista'}
              </Text>
              <Text style={[styles.reviewsHeaderSub, { color: colors.textSecondary }]}>
                Comentários públicos de quem já convidou
              </Text>
            </View>
          </View>

          {reviewsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : reviewsError ? (
            <View style={styles.centered}>
              <Text style={{ color: colors.error }}>{reviewsError}</Text>
            </View>
          ) : reviewsList.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ color: colors.textSecondary }}>Sem comentários públicos ainda.</Text>
            </View>
          ) : (
            <FlatList
              data={reviewsList}
              keyExtractor={(item, idx) => `${item.artista_avaliador_id}-${item.criado_em}-${idx}`}
              contentContainerStyle={styles.reviewsListContent}
              renderItem={({ item }) => (
                <View style={[styles.reviewItemCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={styles.reviewItemTop}>
                    <View style={styles.reviewItemAuthorRow}>
                      <OptimizedImage
                        imageUrl={item.artista_avaliador_imagem || ''}
                        style={styles.reviewItemAvatar}
                        fallbackText={item.artista_avaliador_nome || 'Artista'}
                        fallbackIcon="person"
                        fallbackIconSize={12}
                        fallbackIconColor={colors.primary}
                        showLoadingIndicator={false}
                      />
                      <Text style={[styles.reviewItemAuthor, { color: colors.text }]} numberOfLines={1}>
                        {item.artista_avaliador_nome}
                      </Text>
                    </View>
                    <Text style={[styles.reviewItemStars, { color: colors.warning }]}>
                      {'★'.repeat(Math.max(1, Math.min(5, item.nota_geral)))}
                    </Text>
                  </View>
                  <Text style={[styles.reviewItemComment, { color: colors.textSecondary }]}>
                    {item.comentario_publico}
                  </Text>
                  <Text style={[styles.reviewItemMeta, { color: colors.textSecondary }]}>
                    {item.nome_evento ? `${item.nome_evento} · ` : ''}
                    {formatReviewDate(item.criado_em)}
                  </Text>
                </View>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={inviteModalVisible && selectedArtist != null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => {
          Keyboard.dismiss();
          setInviteModalVisible(false);
        }}
      >
        <SafeAreaView style={[styles.inviteModalRoot, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
          <KeyboardAvoidingView
            style={styles.flex1}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setInviteModalVisible(false);
                }}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Convite</Text>
              <View style={styles.modalCloseBtn} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={styles.inviteFormScroll}
              nestedScrollEnabled
            >
              <Text style={[styles.formPanelTitle, { color: colors.text }]}>Dados do convite</Text>
              <View style={[styles.inviteArtistBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <OptimizedImage
                  imageUrl={selectedSearchRow?.image_url ?? selectedSearchRow?.profile_url ?? ''}
                  style={styles.inviteBannerAvatar}
                  fallbackText={selectedLabel}
                  fallbackIcon="person"
                  fallbackIconSize={16}
                  fallbackIconColor={colors.primary}
                  showLoadingIndicator={false}
                />
                <View style={styles.inviteBannerText}>
                  <Text style={[styles.selectedLine, { color: colors.textSecondary, marginBottom: 0 }]}>
                    Convidando
                  </Text>
                  <Text style={[styles.inviteBannerName, { color: colors.text }]} numberOfLines={2}>
                    {selectedLabel}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setInviteModalVisible(false);
                }}
                style={styles.formChangeArtistBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="arrow-back-outline" size={16} color={colors.primary} />
                <Text style={[styles.formChangeArtistText, { color: colors.primary }]}>Trocar artista</Text>
              </TouchableOpacity>

              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Cachê oferecido (R$)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={cacheDraft}
                onChangeText={(t) => setCacheDraft(formatCurrencyBRLInput(t))}
              />
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Seu WhatsApp para contato (opcional)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                value={whatsDraft}
                onChangeText={(t) => setWhatsDraft(maskBrazilMobile(t))}
              />
              <Text style={[styles.inviteFuncLabel, { color: colors.text }]}>Função no evento</Text>
              <Text style={[styles.filterFieldHint, { color: colors.textSecondary }]}>
                Sugestões rápidas — toque em um chip ou digite outra função. Vários convites na mesma rodada disputam uma
                vaga; use «Outra vaga» se precisar de outro músico para o mesmo papel.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.inviteFuncPresetRow}
                keyboardShouldPersistTaps="handled"
              >
                {ARTIST_WORK_ROLE_PRESETS.map((role) => {
                  const selected = functionDraft.trim() === role;
                  return (
                    <TouchableOpacity
                      key={`invite-func-${role}`}
                      onPress={() => {
                        Keyboard.dismiss();
                        setFunctionDraft(role);
                      }}
                      activeOpacity={0.75}
                      style={[
                        styles.funcPresetChip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? `${colors.primary}18` : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.funcPresetChipText,
                          {
                            color: selected ? colors.primary : colors.text,
                            fontWeight: selected ? '800' : '600',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {role}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Ou digite a função (ex.: violão, voz)"
                placeholderTextColor={colors.textSecondary}
                value={functionDraft}
                onChangeText={setFunctionDraft}
              />
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setInviteDisputeGroupId(newInviteDisputeGroupId());
                  Alert.alert(
                    'Nova rodada',
                    'Os próximos convites desta tela passam a valer para outra vaga (ex.: segundo músico da mesma função).'
                  );
                }}
                style={styles.inviteNovaRodadaBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
                <Text style={[styles.inviteNovaRodadaText, { color: colors.primary }]}>
                  Outra vaga (nova rodada)
                </Text>
              </TouchableOpacity>
              <TextInput
                style={[
                  styles.input,
                  styles.messageInput,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                ]}
                placeholder="Mensagem (opcional)"
                placeholderTextColor={colors.textSecondary}
                value={messageDraft}
                onChangeText={setMessageDraft}
                multiline
              />

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btnSecondary, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setInviteModalVisible(false);
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Fechar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                  onPress={() => void handleSubmit()}
                  disabled={sending}
                >
                  {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Enviar convite</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={leilaoModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => {
          Keyboard.dismiss();
          setLeilaoModalVisible(false);
        }}
      >
        <SafeAreaView style={[styles.inviteModalRoot, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
          <KeyboardAvoidingView
            style={styles.flex1}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setLeilaoModalVisible(false);
                }}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Leilão</Text>
              <View style={styles.modalCloseBtn} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={styles.inviteFormScroll}
            >
              <Text style={[styles.formPanelTitle, { color: colors.text }]}>
                Participantes ({leilaoSelectedIds.length})
              </Text>
              <Text style={[styles.filterFieldHint, { color: colors.textSecondary, marginBottom: 10 }]}>
                Todos recebem o mesmo convite (cachê, função e mensagem). O primeiro que aceitar mantém a vaga. Toque no
                × para retirar alguém da lista.
              </Text>
              <View style={styles.leilaoArtistsScroll}>
                {leilaoSelectedIds.map((id) => {
                  const meta = leilaoArtistMeta[id];
                  const label = meta?.name?.trim() || id;
                  const imageUrl = meta?.imageUrl ?? '';
                  return (
                    <View
                      key={`leilao-card-${id}`}
                      style={[styles.leilaoArtistCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    >
                      <TouchableOpacity
                        onPress={() => removeLeilaoArtist(id)}
                        style={styles.leilaoArtistRemove}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Remover ${label} do leilão`}
                      >
                        <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <OptimizedImage
                        imageUrl={imageUrl}
                        style={[styles.leilaoArtistAvatar, { borderColor: `${colors.primary}33` }]}
                        fallbackText={label}
                        fallbackIcon="person"
                        fallbackIconSize={22}
                        fallbackIconColor={colors.primary}
                        showLoadingIndicator={false}
                      />
                      <View style={styles.leilaoArtistNameRow}>
                        <Ionicons name="mic-outline" size={12} color={colors.primary} style={{ marginTop: 2 }} />
                        <Text style={[styles.leilaoArtistName, { color: colors.text }]} numberOfLines={2}>
                          {label}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Cachê oferecido (R$)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={cacheDraft}
                onChangeText={(t) => setCacheDraft(formatCurrencyBRLInput(t))}
              />
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Seu WhatsApp para contato (opcional)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                value={whatsDraft}
                onChangeText={(t) => setWhatsDraft(maskBrazilMobile(t))}
              />
              <Text style={[styles.inviteFuncLabel, { color: colors.text }]}>Função no evento</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.inviteFuncPresetRow}
                keyboardShouldPersistTaps="handled"
              >
                {ARTIST_WORK_ROLE_PRESETS.map((role) => {
                  const selected = functionDraft.trim() === role;
                  return (
                    <TouchableOpacity
                      key={`leilao-func-${role}`}
                      onPress={() => {
                        Keyboard.dismiss();
                        setFunctionDraft(role);
                      }}
                      activeOpacity={0.75}
                      style={[
                        styles.funcPresetChip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? `${colors.primary}18` : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.funcPresetChipText,
                          {
                            color: selected ? colors.primary : colors.text,
                            fontWeight: selected ? '800' : '600',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {role}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Ou digite a função (ex.: violão, voz)"
                placeholderTextColor={colors.textSecondary}
                value={functionDraft}
                onChangeText={setFunctionDraft}
              />
              <TextInput
                style={[
                  styles.input,
                  styles.messageInput,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                ]}
                placeholder="Mensagem (opcional)"
                placeholderTextColor={colors.textSecondary}
                value={messageDraft}
                onChangeText={setMessageDraft}
                multiline
              />
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btnSecondary, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setLeilaoModalVisible(false);
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                  onPress={() => void handleLeilaoSubmit()}
                  disabled={sending}
                >
                  {sending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Enviar {leilaoSelectedIds.length} convite(s)</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <FeedFuncaoPickerModal
        visible={showFilterGenero}
        onClose={() => setShowFilterGenero(false)}
        options={[...ARTIST_MUSICAL_STYLE_PRESETS]}
        selectedFuncao={filterGenero}
        onSelect={(value) => setFilterGenero(value || '')}
        title="Filtrar por gênero"
        searchPlaceholder="Buscar gênero..."
        clearLabel="Todos os gêneros"
        emptyLabel="Nenhum gênero encontrado."
      />
      <FeedFuncaoPickerModal
        visible={showFilterFuncao}
        onClose={() => setShowFilterFuncao(false)}
        options={[...ARTIST_WORK_ROLE_PRESETS]}
        selectedFuncao={filterRole}
        onSelect={(value) => setFilterRole(value || '')}
        title="Filtrar por função"
        searchPlaceholder="Buscar função..."
        clearLabel="Todas as funções"
        emptyLabel="Nenhuma função encontrada."
      />
      <FeedFuncaoPickerModal
        visible={showFilterFormato}
        onClose={() => setShowFilterFormato(false)}
        options={[...ARTIST_SHOW_FORMAT_PRESETS]}
        selectedFuncao={filterFormato}
        onSelect={(value) => setFilterFormato(value || '')}
        title="Filtrar por formato de show"
        searchPlaceholder="Buscar formação..."
        clearLabel="Todos os formatos"
        emptyLabel="Nenhum formato encontrado."
      />
      <Modal
        visible={sentInvite != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSentInvite(null)}
      >
        <View style={styles.sentOverlay}>
          <View style={[styles.sentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.sentIconWrap, { backgroundColor: `${colors.success}18` }]}>
              <Ionicons name="checkmark-circle" size={56} color={colors.success} />
            </View>
            <Text style={[styles.sentTitle, { color: colors.text }]}>{sentInvite?.title}</Text>
            <Text style={[styles.sentMessage, { color: colors.textSecondary }]}>{sentInvite?.message}</Text>
            {sentInvite ? (
              <View style={[styles.sentArtistRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <OptimizedImage
                  imageUrl={sentInvite.imageUrl}
                  style={[styles.sentAvatar, { borderColor: colors.border }]}
                  cacheKey={`sent_invite_${sentInvite.name}`}
                  fallbackText={sentInvite.name || 'Artista'}
                  fallbackIcon="person"
                  fallbackIconSize={22}
                  fallbackIconColor={colors.primary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.sentArtistName, { color: colors.text }]} numberOfLines={1}>
                    {sentInvite.name}
                  </Text>
                  <Text style={[styles.sentArtistHint, { color: colors.textSecondary }]} numberOfLines={1}>
                    Aguardando resposta
                  </Text>
                </View>
              </View>
            ) : null}
            {sentInvite?.showMoreActions ? (
              <>
                <TouchableOpacity
                  style={[styles.sentPrimary, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    const eventoId = eventData?.id;
                    setSentInvite(null);
                    setSelectedArtist(null);
                    if (!eventoId) return;
                    void (async () => {
                      const { convites } = await listarConvitesDoEvento(eventoId);
                      setBlockedArtists(
                        new Set(
                          (convites || [])
                            .filter((c) => c.status === 'pendente' || c.status === 'aceito')
                            .map((c) => c.artista_convidado_id)
                        )
                      );
                    })();
                  }}
                >
                  <Text style={styles.sentPrimaryText}>Convidar outro artista</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sentSecondary, { borderColor: colors.border }]}
                  onPress={() => {
                    const eventoId = eventData?.id;
                    setInviteDisputeGroupId(newInviteDisputeGroupId());
                    setSentInvite(null);
                    setSelectedArtist(null);
                    if (!eventoId) return;
                    void (async () => {
                      const { convites } = await listarConvitesDoEvento(eventoId);
                      setBlockedArtists(
                        new Set(
                          (convites || [])
                            .filter((c) => c.status === 'pendente' || c.status === 'aceito')
                            .map((c) => c.artista_convidado_id)
                        )
                      );
                    })();
                  }}
                >
                  <Text style={[styles.sentSecondaryText, { color: colors.text }]}>Nova rodada</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sentTextBtn} onPress={() => router.back()}>
                  <Text style={[styles.sentSecondaryText, { color: colors.textSecondary }]}>Concluir</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.sentPrimary, { backgroundColor: colors.primary }]}
                onPress={() => setSentInvite(null)}
              >
                <Text style={styles.sentPrimaryText}>Entendi</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex1: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerLeilaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    minWidth: 44,
    justifyContent: 'center',
  },
  leilaoHintBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leilaoHintText: { flex: 1, fontSize: 13, lineHeight: 19 },
  leilaoFunctionSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leilaoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  leilaoBarText: { fontSize: 15, fontWeight: '700' },
  leilaoBarBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  leilaoBarBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  leilaoArtistsScroll: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 4,
    paddingBottom: 12,
    justifyContent: 'flex-start',
  },
  leilaoArtistCard: {
    width: '31%',
    minWidth: 100,
    maxWidth: 120,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 28,
    paddingBottom: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    position: 'relative',
  },
  leilaoArtistRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    borderRadius: 14,
  },
  leilaoArtistAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leilaoArtistNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 8,
    width: '100%',
    justifyContent: 'center',
  },
  leilaoArtistName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
  },
  resultsList: { flex: 1 },
  resultsListContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  cardSeparator: { height: 10 },
  listSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 6,
    marginTop: 4,
  },
  listEmptyLoading: { paddingVertical: 32, alignItems: 'center' },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    fontSize: 17,
  },
  emptyResults: { paddingVertical: 24, fontSize: 15, lineHeight: 22, paddingHorizontal: 16 },
  inviteModalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalCloseBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  inviteFormScroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  inviteArtistBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  inviteBannerAvatar: { width: 48, height: 48, borderRadius: 24 },
  inviteBannerText: { flex: 1, minWidth: 0 },
  inviteBannerName: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  formPanelTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  inviteFuncLabel: { fontSize: 14, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  inviteNovaRodadaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 10,
    marginBottom: 4,
    paddingVertical: 6,
  },
  inviteNovaRodadaText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  inviteFuncPresetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingRight: 2,
  },
  selectedLine: { fontWeight: '500', marginBottom: 8 },
  formChangeArtistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  formChangeArtistText: { fontSize: 14, fontWeight: '600' },
  recentSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  recentSectionInner: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  recentLoadingRow: { paddingVertical: 8, alignItems: 'flex-start' },
  recentErrorText: { fontSize: 13, lineHeight: 18 },
  recentFilterBlock: { marginBottom: 12 },
  recentFilterTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  recentFilterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  recentFilterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  recentFilterChipText: { fontSize: 13, maxWidth: 200 },
  recentScrollContent: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 8,
    paddingBottom: 2,
  },
  recentCard: {
    width: 200,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  recentCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  recentAvatar: { width: 36, height: 36, borderRadius: 18 },
  recentName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  recentMetaLine: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    marginBottom: 3,
  },
  recentCacheLine: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  recentCacheLineMuted: {
    fontWeight: '600',
  },
  recentCacheLineValue: {
    fontWeight: '800',
  },
  recentRatingCompact: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  recentBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  recentBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  recentBadgeText: { fontSize: 9, fontWeight: '700' },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 2 },
  sectionHint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  subLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  filterBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterBarText: { fontSize: 16, fontWeight: '600' },
  filterBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  filterPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  filterInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  filterInputLast: { marginBottom: 0 },
  filterFieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 2, marginBottom: 6 },
  filterFieldHint: { fontSize: 11, lineHeight: 15, marginBottom: 8, marginTop: -2 },
  funcPresetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingRight: 2,
  },
  funcPresetChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  funcPresetChipText: { fontSize: 12, maxWidth: 180 },
  estadoSelector: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  estadoText: { fontSize: 15, flex: 1 },
  estadosList: {
    marginTop: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
    maxHeight: 200,
    overflow: 'hidden',
  },
  estadosScroll: { maxHeight: 200 },
  estadoItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  estadoItemText: { fontSize: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 17,
  },
  messageInput: { minHeight: 72, textAlignVertical: 'top' },
  rowCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rowCardInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowAvatarMd: { width: 48, height: 48, borderRadius: 24 },
  rowCardInfo: { flex: 1, minWidth: 0 },
  rowCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  artistNameCard: { fontSize: 17, lineHeight: 22, flex: 1, minWidth: 0 },
  ratingCardInline: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  ratingInlineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingInlineStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  ratingInlineValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  ratingInlineComment: {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
  },
  ratingInlineAction: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  ratingInlineEmpty: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
  },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  reviewsHeaderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  reviewsHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  reviewsHeaderSub: {
    fontSize: 12,
    marginTop: 2,
  },
  reviewsListContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  reviewItemCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  reviewItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  reviewItemAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  reviewItemAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  reviewItemAuthor: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  reviewItemStars: {
    fontSize: 13,
    fontWeight: '800',
  },
  reviewItemComment: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  reviewItemMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardBlockTop: { marginTop: 8, gap: 6 },
  cardBlockSection: { marginTop: 10 },
  cardBlockFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metaChipsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  stylePill: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  whatsTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  whatsTagText: { fontSize: 11, fontWeight: '800' },
  whatsContactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whatsContactText: { fontSize: 14, fontWeight: '600', flex: 1 },
  groupLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  rolesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  roleChipText: { fontSize: 11, fontWeight: '600' },
  formatChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  formatChipText: { fontSize: 11, fontWeight: '600' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { fontSize: 13, flex: 1, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnSecondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    flex: 1.2,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sentCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 18,
  },
  sentIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  sentTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  sentMessage: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  sentArtistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  sentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
  },
  sentArtistName: {
    fontSize: 16,
    fontWeight: '700',
  },
  sentArtistHint: {
    fontSize: 13,
    marginTop: 2,
  },
  sentPrimary: {
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sentPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  sentSecondary: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sentSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
  },
  sentTextBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
