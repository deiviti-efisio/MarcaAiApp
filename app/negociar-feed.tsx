import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrazilStatePickerModal, {
  BrazilStateFieldButton,
} from '../components/BrazilStatePickerModal';
import PropostaEnviadaModal from '../components/PropostaEnviadaModal';
import ArtistReputationBadge from '../components/ArtistReputationBadge';
import ArtistReviewsModal from '../components/ArtistReviewsModal';
import { ARTIST_WORK_ROLE_PRESETS } from '../constants/artistProfileLists';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatEventLocationSlash } from '../lib/brazilGeo';
import { formatCalendarDate } from '../lib/dateUtils';
import {
  desfazerPropostaFeed,
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

function toHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

function hmToDate(hm: string): Date {
  const d = new Date();
  const parts = String(hm || '').split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  d.setHours(h, m, 0, 0);
  return d;
}

export default function NegociarFeedScreen() {
  const { colors, isDarkMode } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { canCreateEvents } = usePermissions();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const [anuncio, setAnuncio] = useState<FeedAnuncio | null>(null);
  const [loading, setLoading] = useState(true);
  const [funcao, setFuncao] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [nomeEvento, setNomeEvento] = useState('');
  const [cidade, setCidade] = useState('');
  const [estadoUf, setEstadoUf] = useState('');
  const [showEstados, setShowEstados] = useState(false);
  const [inicio, setInicio] = useState(() => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    return d;
  });
  const [fim, setFim] = useState(() => {
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    return d;
  });
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [sending, setSending] = useState(false);
  const [showPropostaEnviada, setShowPropostaEnviada] = useState(false);
  const [desfazendoProposta, setDesfazendoProposta] = useState(false);
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
      if (found && found.feed_tipo === 'disponivel') {
        setCidade(found.city || '');
        setEstadoUf(found.state_uf || '');
        if (found.start_time) setInicio(hmToDate(found.start_time));
        if (found.end_time) setFim(hmToDate(found.end_time));
      }
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
      if (found.ja_proposei) {
        setShowPropostaEnviada(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, activeArtist?.id]);

  const location = useMemo(
    () =>
      anuncio
        ? formatEventLocationSlash({ city: anuncio.city, state_uf: anuncio.state_uf })
        : '',
    [anuncio]
  );

  const whatsappUrl = useMemo(
    () => buildWhatsAppUrl(anuncio?.artist_whatsapp),
    [anuncio?.artist_whatsapp]
  );

  const submit = async () => {
    if (!anuncio || !activeArtist?.id) return;
    if (anuncio.artist_id === activeArtist.id) {
      Alert.alert('Seu anúncio', 'Você não pode negociar a própria publicação.');
      return;
    }
    if (!canCreateEvents) {
      Alert.alert('Sem permissão', 'Somente admin ou vendedor pode iniciar negociação.');
      return;
    }
    const estaProcurando = anuncio.feed_tipo === 'demanda';
    if (estaProcurando && !funcao.trim()) {
      Alert.alert('Função', 'Informe a função que você está oferecendo (ex.: Vocalista).');
      return;
    }
    if (!estaProcurando && !nomeEvento.trim()) {
      Alert.alert('Nome do evento', 'Informe o nome do evento em que você está contratando.');
      return;
    }
    if (!estaProcurando && !cidade.trim()) {
      Alert.alert('Local', 'Informe a cidade do evento.');
      return;
    }
    if (!estaProcurando && toHm(fim) <= toHm(inicio)) {
      Alert.alert('Horário', 'O horário final precisa ser depois do início.');
      return;
    }
    const funcoesOferta = anuncio.feed_funcoes.map((f) => f.trim()).filter(Boolean).join(' · ');
    setSending(true);
    const result = await iniciarNegociacaoFeed({
      eventoId: anuncio.id,
      artistaInteressadoId: activeArtist.id,
      funcaoParticipacao: estaProcurando ? funcao.trim() : funcoesOferta || 'Participação',
      mensagem,
      nomeEvento: estaProcurando ? null : nomeEvento.trim(),
      eventDate: estaProcurando ? null : anuncio.event_date,
      startTime: estaProcurando ? null : toHm(inicio),
      endTime: estaProcurando ? null : toHm(fim),
      city: estaProcurando ? null : cidade.trim(),
      stateUf: estaProcurando ? null : estadoUf.trim() || null,
    });
    setSending(false);
    if (!result.success) {
      if (isErroPropostaDuplicada(result.error)) {
        setShowPropostaEnviada(true);
        return;
      }
      Alert.alert('Erro', result.error || 'Não foi possível enviar o interesse.');
      return;
    }
    router.back();
  };

  const fecharPropostaEnviada = () => {
    setShowPropostaEnviada(false);
    router.back();
  };

  const handleDesfazerProposta = async () => {
    if (!anuncio || !activeArtist?.id || desfazendoProposta) return;
    setDesfazendoProposta(true);
    const { success, error } = await desfazerPropostaFeed({
      eventoId: anuncio.id,
      artistaInteressadoId: activeArtist.id,
    });
    setDesfazendoProposta(false);
    if (!success) {
      Alert.alert('Desfazer', error || 'Não foi possível desfazer a proposta.');
      return;
    }
    setShowPropostaEnviada(false);
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Negociação</Text>
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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
                  {anuncio.feed_funcoes.map((funcao) => (
                    <View
                      key={funcao}
                      style={[styles.funcaoChip, { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}33` }]}
                    >
                      <Text style={[styles.funcaoChipText, { color: colors.primary }]}>{funcao}</Text>
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
                  Cachê:{' '}
                  {Number(anuncio.cache_valor ?? 0).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                  . Ao aceitar, entra como despesa na agenda.
                </Text>
              </View>
              {whatsappUrl ? (
                <TouchableOpacity
                  style={[styles.whatsappBtn, { borderColor: '#16A34A', backgroundColor: '#16A34A10' }]}
                  onPress={() => void openWhatsAppConversation(anuncio.artist_whatsapp)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                  <Text style={styles.whatsappBtnText}>Chamar no WhatsApp</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {anuncio.feed_tipo === 'demanda' ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>
                  Função que você está oferecendo
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.roles}
                >
                  {ARTIST_WORK_ROLE_PRESETS.map((role) => {
                    const active = funcao === role;
                    return (
                      <TouchableOpacity
                        key={role}
                        style={[
                          styles.roleChip,
                          {
                            backgroundColor: active ? colors.primary : colors.surface,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => setFuncao(role)}
                      >
                        <Text
                          style={{
                            color: active ? '#fff' : colors.text,
                            fontWeight: '700',
                            fontSize: 13,
                          }}
                        >
                          {role}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TextInput
                  value={funcao}
                  onChangeText={setFuncao}
                  placeholder="Ou escreva outra função"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                  ]}
                />
              </>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Dados do seu evento
                </Text>
                <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                  A oferta é uma disponibilidade. Informe o evento em que você quer contratar.
                </Text>
                <Text style={[styles.label, { color: colors.text }]}>
                  Nome do evento
                </Text>
                <TextInput
                  value={nomeEvento}
                  onChangeText={setNomeEvento}
                  placeholder="Ex.: Casamento da Ana"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={80}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                  ]}
                />
                <Text style={[styles.label, { color: colors.text }]}>Data</Text>
                <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <Text style={[styles.fieldText, { color: colors.text }]}>
                    {formatCalendarDate(anuncio.event_date)}
                  </Text>
                </View>
                <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                  Data em que o artista está disponível.
                </Text>
                <View style={styles.timeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: colors.text }]}>Início</Text>
                    <TouchableOpacity
                      style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={() => setPicker('start')}
                    >
                      <Text style={[styles.fieldText, { color: colors.text }]}>{toHm(inicio)}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: colors.text }]}>Fim</Text>
                    <TouchableOpacity
                      style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={() => setPicker('end')}
                    >
                      <Text style={[styles.fieldText, { color: colors.text }]}>{toHm(fim)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {picker ? (
                  <View>
                    <DateTimePicker
                      value={picker === 'start' ? inicio : fim}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(ev, date) => {
                        if (Platform.OS === 'android') setPicker(null);
                        if (ev.type === 'dismissed' || !date) {
                          if (Platform.OS === 'ios' && ev.type === 'dismissed') setPicker(null);
                          return;
                        }
                        if (picker === 'start') setInicio(date);
                        if (picker === 'end') setFim(date);
                      }}
                      themeVariant={isDarkMode ? 'dark' : 'light'}
                    />
                    {Platform.OS === 'ios' ? (
                      <TouchableOpacity
                        style={[styles.okPicker, { backgroundColor: colors.primary }]}
                        onPress={() => setPicker(null)}
                      >
                        <Text style={styles.okPickerText}>OK</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                <Text style={[styles.label, { color: colors.text }]}>Estado</Text>
                <BrazilStateFieldButton
                  selectedUf={estadoUf}
                  onPress={() => setShowEstados(true)}
                  colors={colors}
                />
                <Text style={[styles.label, { color: colors.text }]}>Cidade</Text>
                <TextInput
                  value={cidade}
                  onChangeText={setCidade}
                  placeholder="Ex.: São Paulo"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                  ]}
                />
              </>
            )}

            <Text style={[styles.label, { color: colors.text }]}>Mensagem (opcional)</Text>
            <TextInput
              value={mensagem}
              onChangeText={setMensagem}
              placeholder="Ex.: Posso nesse horário, confirmo rápido."
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[
                styles.input,
                styles.multiline,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
            />

            <TouchableOpacity
              style={[styles.submit, { backgroundColor: colors.primary, opacity: sending ? 0.7 : 1 }]}
              onPress={() => void submit()}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Confirmar interesse</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      <PropostaEnviadaModal
        visible={showPropostaEnviada}
        isDemanda={anuncio?.feed_tipo === 'demanda'}
        podeDesfazer={!!anuncio?.pode_desfazer || anuncio?.ja_proposei}
        desfazendo={desfazendoProposta}
        onClose={fecharPropostaEnviada}
        onVerConvites={() => {
          setShowPropostaEnviada(false);
          router.replace('/convites-participacao-evento');
        }}
        onDesfazer={() => void handleDesfazerProposta()}
      />
      <ArtistReviewsModal
        visible={showReviews}
        artistId={anuncio?.artist_id ?? null}
        artistName={anuncio?.artist_name ?? 'Artista'}
        artistImage={anuncio?.artist_image}
        onClose={() => setShowReviews(false)}
      />
      <BrazilStatePickerModal
        visible={showEstados}
        onClose={() => setShowEstados(false)}
        selectedUf={estadoUf}
        onSelect={(uf) => setEstadoUf(uf || '')}
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
  body: { padding: 16, paddingBottom: 40, gap: 8 },
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
  sectionTitle: { fontSize: 16, fontWeight: '800', marginTop: 8 },
  sectionHint: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  timeRow: { flexDirection: 'row', gap: 10 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldText: { fontSize: 16, fontWeight: '600' },
  okPicker: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  okPickerText: { color: '#fff', fontWeight: '800' },
  whatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 6,
  },
  whatsappBtnText: { color: '#16A34A', fontWeight: '800', fontSize: 14 },
  label: { fontSize: 14, fontWeight: '700', marginTop: 12 },
  roles: { gap: 8, paddingVertical: 4 },
  roleChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  submit: {
    marginTop: 18,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
