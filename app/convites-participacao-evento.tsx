import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatChatCache, openArtistChatInApp, type ShowChatContext } from '../lib/openArtistChat';
import { formatCalendarDate } from '../lib/dateUtils';
import {
  aceitarConviteParticipacao,
  listarConvitesPendentesRecebidos,
  obterNomeArtista,
  recusarConviteParticipacao,
  type ConviteParticipacaoEventoRow,
} from '../services/supabase/conviteParticipacaoEventoService';
import { supabase } from '../lib/supabase';
import { useActiveArtist } from '../services/useActiveArtist';
import ParceriaFeitaModal from '../components/ParceriaFeitaModal';
import { buildWhatsAppUrl } from '../utils/brazilPhone';

function formatTime(t: string) {
  if (!t) return '';
  return t.slice(0, 5);
}

function formatTimeRange(start: string, end: string) {
  const s = formatTime(start) || '00:00';
  const e = formatTime(end) || '00:00';
  if (s === '00:00' && e === '00:00') return 'Horário não definido';
  if (e && e !== s) return `${s} – ${e}`;
  return s;
}

function showContextFromConvite(item: ConviteParticipacaoEventoRow): ShowChatContext {
  const local = [item.cidade, item.estado_uf].filter(Boolean).join(' / ');
  const funcao = item.funcao_participacao?.trim();
  return {
    nome: item.nome_evento,
    data: formatCalendarDate(item.data_evento),
    horario: formatTimeRange(item.hora_inicio, item.hora_fim),
    local: local || null,
    funcao: funcao && funcao.toLowerCase() !== 'interesse' ? funcao : null,
    cache: formatChatCache(item.cache_valor),
  };
}

export default function ConvitesParticipacaoEventoScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { isAdmin } = usePermissions();
  const [convites, setConvites] = useState<ConviteParticipacaoEventoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedRejectInvite, setSelectedRejectInvite] = useState<ConviteParticipacaoEventoRow | null>(null);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [selectedAcceptInvite, setSelectedAcceptInvite] = useState<ConviteParticipacaoEventoRow | null>(null);
  const [parceriaFeita, setParceriaFeita] = useState<{
    partnerName: string;
    eventName: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    if (!activeArtist?.id) {
      setConvites([]);
      setLoading(false);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
    const { convites: list, error } = await listarConvitesPendentesRecebidos(activeArtist.id);
    if (error) {
      Alert.alert('Erro', error);
      setConvites([]);
    } else {
      setConvites(list);
      const map: Record<string, string> = {};
      for (const c of list) {
        if (!map[c.artista_que_convidou_id]) {
          const n = await obterNomeArtista(c.artista_que_convidou_id);
          if (n) map[c.artista_que_convidou_id] = n;
        }
      }
      setNames((prev) => ({ ...prev, ...map }));
    }
    setLoading(false);
    setRefreshing(false);
  }, [activeArtist?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  // Escuta mudanças diretas na tabela de convites de participação.
  // Assim, o convidado vê novos convites mesmo sem depender de push/notifications.
  useEffect(() => {
    if (!activeArtist?.id) return;

    const channel = supabase
      .channel(`convite-participacao-evento:${activeArtist.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'convite_participacao_evento',
          filter: `artista_convidado_id=eq.${activeArtist.id}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeArtist?.id, load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const handleAceitar = (c: ConviteParticipacaoEventoRow) => {
    setSelectedAcceptInvite(c);
    setShowAcceptModal(true);
  };

  const submitAceite = async () => {
    if (!userId || !activeArtist?.id || !selectedAcceptInvite) return;
    const { success, error } = await aceitarConviteParticipacao(
      selectedAcceptInvite.id,
      userId,
      activeArtist.id,
      { funcaoParticipacao: selectedAcceptInvite.funcao_participacao ?? null }
    );
    if (success) {
      const convite = selectedAcceptInvite;
      setShowAcceptModal(false);
      setSelectedAcceptInvite(null);
      void load();
      setParceriaFeita({
        partnerName: names[convite.artista_que_convidou_id] || 'o anunciante',
        eventName: convite.nome_evento?.trim() || null,
      });
    } else {
      const msg = (error || '').trim();
      const msgLower = msg.toLowerCase();
      const conviteIndisponivel =
        msgLower.includes('cancelado') ||
        msgLower.includes('não está mais') ||
        msgLower.includes('nao esta mais') ||
        msgLower.includes('já foi aceito') ||
        msgLower.includes('ja foi aceito') ||
        msgLower.includes('já foi recusado') ||
        msgLower.includes('ja foi recusado') ||
        msgLower.includes('não está mais disponível') ||
        msgLower.includes('nao esta mais disponivel');
      if (conviteIndisponivel) {
        Alert.alert(
          'Convite indisponível',
          msg ||
            'Este convite não está mais ativo (por exemplo, cancelado pelo organizador). Sua agenda não foi alterada.'
        );
      } else {
        Alert.alert('Erro', msg || 'Não foi possível aceitar.');
      }
    }
  };

  const handleRecusar = (c: ConviteParticipacaoEventoRow) => {
    setSelectedRejectInvite(c);
    setRejectReason('');
    setShowRejectModal(true);
  };

  const submitRecusa = async () => {
    if (!selectedRejectInvite) return;
    const { success, error } = await recusarConviteParticipacao(selectedRejectInvite.id, {
      motivo: rejectReason,
      usuarioRecusouId: userId,
    });
    if (success) {
      setShowRejectModal(false);
      setSelectedRejectInvite(null);
      setRejectReason('');
      void load();
    } else {
      Alert.alert('Erro', error || 'Falha ao recusar.');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Convites de participação</Text>
        <View style={{ width: 40 }} />
      </View>

      {!activeArtist ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>Selecione um artista nas configurações.</Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={convites}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={convites.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="mail-open-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Nenhum convite pendente</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Quando outro artista convidar você para um evento, aparecerá aqui.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const inviterName = names[item.artista_que_convidou_id] || 'Artista';
            return (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.inviterHighlight, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}33` }]}>
                  <View style={[styles.inviterAvatar, { backgroundColor: `${colors.primary}22` }]}>
                    <Ionicons name="person" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.inviterInfo}>
                    <Text style={[styles.inviterLabel, { color: colors.textSecondary }]}>Convidado por</Text>
                    <Text style={[styles.inviterName, { color: colors.text }]} numberOfLines={1}>
                      {inviterName}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.nome_evento}</Text>
                <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                  {formatCalendarDate(item.data_evento)} · {formatTimeRange(item.hora_inicio, item.hora_fim)}
                </Text>
                {item.cache_valor != null ? (
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                    Cachê: {Number(item.cache_valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </Text>
                ) : null}
                {item.cidade ? (
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>{item.cidade}</Text>
                ) : null}
                {item.telefone_contratante ? (
                  <View style={styles.whatsRow}>
                    <Text style={[styles.cardMeta, { color: colors.textSecondary, flex: 1 }]}>
                      Contato (quem convida): {item.telefone_contratante}
                    </Text>
                    {buildWhatsAppUrl(item.telefone_contratante) ? (
                      <TouchableOpacity
                        onPress={() => {
                          const url = buildWhatsAppUrl(item.telefone_contratante);
                          if (url) void Linking.openURL(url);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Abrir WhatsApp"
                      >
                        <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                <TouchableOpacity
                  style={styles.whatsRow}
                  onPress={() =>
                    openArtistChatInApp({
                      myArtistId: activeArtist?.id,
                      isAdmin,
                      otherArtistId: item.artista_que_convidou_id,
                      otherArtistName: inviterName,
                      showContext: showContextFromConvite(item),
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                  <Text style={[styles.cardMeta, { color: colors.primary, fontWeight: '700', marginTop: 0 }]}>
                    Conversar
                  </Text>
                </TouchableOpacity>
                {item.funcao_participacao &&
                item.funcao_participacao.trim().toLowerCase() !== 'interesse' ? (
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                    Função sugerida: {item.funcao_participacao}
                  </Text>
                ) : null}
                {item.mensagem ? (
                  <Text style={[styles.msg, { color: colors.text }]}>Mensagem do convite: {item.mensagem}</Text>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btnOutline, { borderColor: colors.error }]}
                    onPress={() => handleRecusar(item)}
                  >
                    <Text style={{ color: colors.error, fontWeight: '600' }}>Recusar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                    onPress={() => handleAceitar(item)}
                  >
                    <Text style={styles.btnPrimaryText}>Aceitar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setShowRejectModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboardWrap}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
            pointerEvents="box-none"
          >
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                <Text style={[styles.modalTitle, { color: colors.text }]}>Recusar convite</Text>
                <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                  Você pode informar o motivo. Esse texto será enviado para quem convidou.
                </Text>
                <TextInput
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  placeholder="Motivo da recusa (opcional)"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </ScrollView>
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={[styles.btnOutline, { borderColor: colors.border, flex: 1 }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowRejectModal(false);
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: colors.error, flex: 1 }]}
                  onPress={() => void submitRecusa()}
                >
                  <Text style={styles.btnPrimaryText}>Confirmar recusa</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showAcceptModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAcceptModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboardWrap}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
          >
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Aceitar convite</Text>
              <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                Confira os dados do convite antes de confirmar sua participação.
              </Text>
              <ScrollView
                style={styles.acceptScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {selectedAcceptInvite ? (
                  <>
                    <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Evento</Text>
                      <Text style={[styles.acceptValue, { color: colors.text }]}>
                        {selectedAcceptInvite.nome_evento}
                      </Text>
                    </View>
                    <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Data</Text>
                      <Text style={[styles.acceptValue, { color: colors.text }]}>
                        {formatCalendarDate(selectedAcceptInvite.data_evento)}
                      </Text>
                    </View>
                    <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Horário</Text>
                      <Text style={[styles.acceptValue, { color: colors.text }]}>
                        {formatTimeRange(selectedAcceptInvite.hora_inicio, selectedAcceptInvite.hora_fim)}
                      </Text>
                    </View>
                    <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Função</Text>
                      <Text style={[styles.acceptValue, { color: colors.text }]}>
                        {selectedAcceptInvite.funcao_participacao?.trim() &&
                        selectedAcceptInvite.funcao_participacao.trim().toLowerCase() !== 'interesse'
                          ? selectedAcceptInvite.funcao_participacao.trim()
                          : 'Participante'}
                      </Text>
                    </View>
                    {selectedAcceptInvite.cache_valor != null ? (
                      <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                        <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Cachê</Text>
                        <Text style={[styles.acceptValue, { color: colors.text }]}>
                          {Number(selectedAcceptInvite.cache_valor).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </Text>
                      </View>
                    ) : null}
                    {selectedAcceptInvite.mensagem?.trim() ? (
                      <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                        <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>Mensagem</Text>
                        <Text style={[styles.acceptMessage, { color: colors.text }]}>
                          {selectedAcceptInvite.mensagem.trim()}
                        </Text>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.acceptInfoBox, { borderColor: colors.primary, backgroundColor: `${colors.primary}10` }]}
                      onPress={() =>
                        openArtistChatInApp({
                          myArtistId: activeArtist?.id,
                          isAdmin,
                          otherArtistId: selectedAcceptInvite.artista_que_convidou_id,
                          otherArtistName: names[selectedAcceptInvite.artista_que_convidou_id],
                          showContext: showContextFromConvite(selectedAcceptInvite),
                        })
                      }
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.acceptLabel, { color: colors.primary }]}>Conversar</Text>
                      <View style={styles.acceptWhatsRow}>
                        <Text style={[styles.acceptValue, { flex: 1, color: colors.text }]}>
                          Falar com {names[selectedAcceptInvite.artista_que_convidou_id] || 'quem convidou'}
                        </Text>
                        <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
                      </View>
                    </TouchableOpacity>
                    {selectedAcceptInvite.telefone_contratante?.trim() ? (
                      <View style={[styles.acceptInfoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                        <Text style={[styles.acceptLabel, { color: colors.textSecondary }]}>WhatsApp (organizador)</Text>
                        <View style={styles.acceptWhatsRow}>
                          <Text style={[styles.acceptValue, { flex: 1 }]}>
                            {selectedAcceptInvite.telefone_contratante.trim()}
                          </Text>
                          {buildWhatsAppUrl(selectedAcceptInvite.telefone_contratante) ? (
                            <TouchableOpacity
                              onPress={() => {
                                const url = buildWhatsAppUrl(selectedAcceptInvite.telefone_contratante);
                                if (url) void Linking.openURL(url);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              accessibilityLabel="Abrir WhatsApp"
                            >
                              <Ionicons name="logo-whatsapp" size={26} color="#25D366" />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btnOutline, { borderColor: colors.border }]}
                  onPress={() => setShowAcceptModal(false)}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                  onPress={() => void submitAceite()}
                >
                  <Text style={styles.btnPrimaryText}>Confirmar aceite</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <ParceriaFeitaModal
        visible={!!parceriaFeita}
        partnerName={parceriaFeita?.partnerName}
        eventName={parceriaFeita?.eventName}
        continueLabel="Fechar"
        onClose={() => setParceriaFeita(null)}
        onVerAgenda={() => {
          setParceriaFeita(null);
          router.push('/(tabs)/agenda');
        }}
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { padding: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  emptyTitle: { marginTop: 16, fontSize: 18, fontWeight: '600' },
  emptySub: { marginTop: 8, textAlign: 'center', maxWidth: 280 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  inviterHighlight: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviterAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviterInfo: {
    marginLeft: 10,
    flex: 1,
  },
  inviterLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  inviterName: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  cardMeta: { marginTop: 4, fontSize: 14 },
  whatsRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  msg: { marginTop: 10, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16, justifyContent: 'flex-end' },
  btnOutline: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalKeyboardWrap: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  modalScrollContent: {
    paddingBottom: 8,
  },
  modalCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    width: '100%',
    maxWidth: 400,
    maxHeight: '88%',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    alignItems: 'stretch',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalSub: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 6,
  },
  acceptInfoBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  acceptScroll: {
    maxHeight: 320,
    marginBottom: 8,
  },
  acceptLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  acceptValue: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  acceptMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  acceptWhatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
