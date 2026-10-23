import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ArtistReputationBadge from '../components/ArtistReputationBadge';
import ArtistReviewsModal from '../components/ArtistReviewsModal';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatCityAndRegion } from '../lib/brazilGeo';
import { formatChatCache, openArtistChatInApp } from '../lib/openArtistChat';
import { formatCalendarDate } from '../lib/dateUtils';
import { getArtistById } from '../services/supabase/artistService';
import {
  iniciarNegociacaoFeed,
  isErroPropostaDuplicada,
  listarFeedMarketplace,
  type FeedAnuncio,
} from '../services/supabase/feedMarketplaceService';
import { useActiveArtist } from '../services/useActiveArtist';
import { buildWhatsAppUrl, openWhatsAppConversation } from '../utils/brazilPhone';

function formatTime(t: string) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

export default function NegociarFeedScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { canCreateEvents, isAdmin } = usePermissions();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const [anuncio, setAnuncio] = useState<FeedAnuncio | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [jaCandidato, setJaCandidato] = useState(false);
  const [zapPublico, setZapPublico] = useState<string | null>(null);
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventId) {
        setLoading(false);
        return;
      }
      const { anuncios, error } = await listarFeedMarketplace({
        filtro: 'todos',
        artistaAtualId: activeArtist?.id ?? null,
        eventoDetalheId: eventId,
      });
      if (cancelled) return;
      if (error) {
        Alert.alert('Erro', error);
        setLoading(false);
        return;
      }
      const found = anuncios.find((a) => a.id === eventId) ?? null;
      setAnuncio(found);
      setJaCandidato(!!found?.ja_proposei);
      setLoading(false);
      if (!found) {
        Alert.alert('Anúncio encerrado', 'A data deste show já passou. O anúncio não está mais disponível.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      const proprio = !!activeArtist?.id && found.artist_id === activeArtist.id;
      if (proprio) {
        Alert.alert('Seu anúncio', 'Você não pode iniciar negociação na sua própria publicação.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      const { artist } = await getArtistById(found.artist_id);
      if (cancelled) return;
      if (artist?.show_whatsapp && artist.whatsapp && buildWhatsAppUrl(artist.whatsapp)) {
        setZapPublico(artist.whatsapp);
      } else {
        setZapPublico(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, activeArtist?.id]);

  const location = useMemo(
    () => (anuncio ? formatCityAndRegion({ city: anuncio.city, state_uf: anuncio.state_uf }) : ''),
    [anuncio]
  );

  const showContext = useMemo(() => {
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

  const abrirWhatsapp = () => {
    if (!zapPublico) {
      Alert.alert('WhatsApp', 'O anunciante não deixou o WhatsApp público.');
      return;
    }
    void openWhatsAppConversation(zapPublico);
  };

  const escolherCanal = () => {
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
      { text: 'Conversar no app', onPress: abrirConversa },
    ];
    if (zapPublico) {
      buttons.push({ text: 'WhatsApp', onPress: abrirWhatsapp });
    }
    buttons.push({ text: 'Agora não', style: 'cancel' });
    Alert.alert(
      'Negociação iniciada',
      zapPublico
        ? 'Fale pelo bate-papo do app ou pelo WhatsApp público.'
        : 'Fale pelo bate-papo do app.',
      buttons
    );
  };

  const iniciar = async () => {
    if (!anuncio || !activeArtist?.id) return;
    if (!canCreateEvents) {
      Alert.alert('Sem permissão', 'Somente admin ou vendedor pode iniciar negociação.');
      return;
    }
    if (jaCandidato) {
      escolherCanal();
      return;
    }
    const funcoesOferta = anuncio.feed_funcoes.map((f) => f.trim()).filter(Boolean).join(' · ');
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
      Alert.alert('Erro', result.error || 'Não foi possível iniciar a negociação.');
      return;
    }
    setJaCandidato(true);
    escolherCanal();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Oportunidade</Text>
        <View style={{ width: 40 }} />
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
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.badge, { color: colors.primary }]}>Oportunidade</Text>
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/perfil-artista', params: { artistId: anuncio.artist_id } })
              }
              activeOpacity={0.75}
            >
              <Text style={[styles.name, { color: colors.text }]}>{anuncio.artist_name}</Text>
            </TouchableOpacity>
            {anuncio.evento_nome ? (
              <Text style={[styles.meta, { color: colors.text }]}>{anuncio.evento_nome}</Text>
            ) : null}
            <ArtistReputationBadge
              reputation={{
                mediaNota: anuncio.artist_media_nota,
                totalAvaliacoes: anuncio.artist_total_avaliacoes,
                showsRealizados: anuncio.artist_shows_realizados,
              }}
              onPressReviews={
                anuncio.artist_total_avaliacoes > 0 ? () => setShowReviews(true) : undefined
              }
            />
            <Text style={[styles.meta, { color: colors.text }]}>
              {formatCalendarDate(anuncio.event_date)} · {formatTime(anuncio.start_time)}–
              {formatTime(anuncio.end_time)}
            </Text>
            {location ? (
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{location}</Text>
            ) : null}
            {anuncio.feed_funcoes.length > 0 ? (
              <View style={styles.funcoesWrap}>
                {anuncio.feed_funcoes.map((item) => (
                  <View
                    key={item}
                    style={[styles.funcaoChip, { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}33` }]}
                  >
                    <Text style={[styles.funcaoChipText, { color: colors.primary }]}>{item}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {anuncio.description ? (
              <Text style={[styles.notes, { color: colors.text }]}>{anuncio.description}</Text>
            ) : null}
            <View style={[styles.lockRow, { backgroundColor: `${colors.primary}12` }]}>
              <Ionicons name="cash-outline" size={16} color={colors.primary} />
              <Text style={[styles.lockText, { color: colors.textSecondary }]}>
                Cachê até{' '}
                {Number(anuncio.cache_valor ?? 0).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
                . Pode ser negociado entre as partes pelo bate-papo.
              </Text>
            </View>
            <Text style={[styles.countHint, { color: colors.textSecondary }]}>
              {anuncio.propostas_count === 1
                ? '1 candidato'
                : `${anuncio.propostas_count} candidatos`}
              {jaCandidato ? ' · você já iniciou a negociação' : ''}
            </Text>
          </View>

          {jaCandidato ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.submit, { backgroundColor: colors.primary }]}
                onPress={abrirConversa}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                <Text style={styles.submitText}>Conversar</Text>
              </TouchableOpacity>
              {zapPublico ? (
                <TouchableOpacity
                  style={[styles.submitOutline, { borderColor: '#16A34A' }]}
                  onPress={abrirWhatsapp}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                  <Text style={[styles.submitOutlineText, { color: '#16A34A' }]}>WhatsApp</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.submit, { backgroundColor: colors.primary, opacity: sending ? 0.7 : 1 }]}
              onPress={() => void iniciar()}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Iniciar negociação</Text>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <ArtistReviewsModal
        visible={showReviews}
        artistId={anuncio?.artist_id ?? null}
        artistName={anuncio?.artist_name ?? 'Artista'}
        artistImage={anuncio?.artist_image}
        onClose={() => setShowReviews(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 6 },
  badge: { fontSize: 12, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800' },
  meta: { fontSize: 14 },
  notes: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  funcoesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  funcaoChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  funcaoChipText: { fontSize: 12, fontWeight: '700' },
  lockRow: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  lockText: { flex: 1, fontSize: 13, lineHeight: 18 },
  countHint: { fontSize: 12, marginTop: 4 },
  actions: { gap: 10 },
  submit: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  submitOutline: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
  },
  submitOutlineText: { fontWeight: '800', fontSize: 16 },
});
