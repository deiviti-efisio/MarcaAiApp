import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatCityAndRegion } from '../lib/brazilGeo';
import { formatCalendarDate, todayCalendarYmd, toCalendarYmd } from '../lib/dateUtils';
import { openArtistChatInApp } from '../lib/openArtistChat';
import { obterNomeArtista } from '../services/supabase/conviteParticipacaoEventoService';
import {
  avaliarParceiroContratacao,
  confirmarRealizacaoContratacao,
  obterContratacao,
  responderCancelamentoContratacao,
  rotuloCicloStatus,
  solicitarCancelamentoContratacao,
  type Contratacao,
} from '../services/supabase/contratacaoService';

const MOTIVOS = ['Imprevisto', 'Conflito de agenda', 'Pagamento / adiantamento', 'Estrutura do evento', 'Outro'];

function StarRow({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (n: number) => void;
  color: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} hitSlop={6}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={26} color="#F59E0B" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ContratacaoScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const params = useLocalSearchParams<{ conviteId?: string }>();
  const conviteId = typeof params.conviteId === 'string' ? params.conviteId : '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<Contratacao | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [descricao, setDescricao] = useState('');
  const [pagamento, setPagamento] = useState('');
  const [respostaNota, setRespostaNota] = useState('');
  const [notaGeral, setNotaGeral] = useState(5);
  const [notaA, setNotaA] = useState(0);
  const [notaB, setNotaB] = useState(0);
  const [notaC, setNotaC] = useState(0);
  const [notaD, setNotaD] = useState(0);
  const [comentario, setComentario] = useState('');

  const load = useCallback(async () => {
    if (!conviteId) {
      setError('Contratação inválida.');
      setLoading(false);
      return;
    }
    const { contratacao, error: err } = await obterContratacao(conviteId);
    setError(err);
    setItem(contratacao);
    if (contratacao) {
      const ids = [contratacao.artista_anfitriao_id, contratacao.artista_convidado_id];
      const next: Record<string, string> = {};
      for (const id of ids) {
        const n = await obterNomeArtista(id);
        if (n) next[id] = n;
      }
      setNomes((prev) => ({ ...prev, ...next }));
    }
    setLoading(false);
  }, [conviteId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const myId = activeArtist?.id || '';
  const souAnfitriao = !!item && myId === item.artista_anfitriao_id;
  const souConvidado = !!item && myId === item.artista_convidado_id;
  const souParte = souAnfitriao || souConvidado;
  const outroId = item
    ? souAnfitriao
      ? item.artista_convidado_id
      : item.artista_anfitriao_id
    : '';
  const pendente = item?.cancelamentos.find((c) => c.status === 'pending') || null;
  const euSolicitei = pendente && pendente.solicitado_por_artista_id === myId;
  const euRespondo = pendente && !euSolicitei && souParte;
  const dataPassou = item ? toCalendarYmd(item.data_evento) < todayCalendarYmd() : false;
  const jaConfirmeiShow = item
    ? souAnfitriao
      ? item.show_confirmado_anfitriao
      : item.show_confirmado_convidado
    : false;
  const podeAvaliar = item?.ciclo_status === 'completed' || item?.show_confirmado;
  const cancelado =
    item?.ciclo_status === 'cancelled' || item?.ciclo_status === 'cancelled_by_mutual_agreement';
  const podePedirCancel =
    souParte &&
    item?.status_convite === 'aceito' &&
    !cancelado &&
    item.ciclo_status !== 'completed' &&
    item.ciclo_status !== 'cancellation_requested' &&
    !pendente;

  const local = useMemo(
    () =>
      item
        ? formatCityAndRegion({ city: item.cidade, state_uf: item.estado_uf })
        : '',
    [item]
  );

  const run = async (fn: () => Promise<{ success: boolean; error: string | null }>, ok: string) => {
    setSaving(true);
    const res = await fn();
    setSaving(false);
    if (!res.success) {
      Alert.alert('Não foi possível', res.error || 'Tente de novo.');
      return;
    }
    Alert.alert('Pronto', ok);
    await load();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Contratação</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !item ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            {error || 'Contratação não encontrada.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.badge, { backgroundColor: `${colors.primary}18` }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {rotuloCicloStatus(item.ciclo_status)}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{item.nome_evento}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {formatCalendarDate(item.data_evento)}
            {item.hora_inicio ? ` · ${String(item.hora_inicio).slice(0, 5)}–${String(item.hora_fim || '').slice(0, 5)}` : ''}
          </Text>
          {local ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{local}</Text>
          ) : null}

          <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Partes</Text>
            <Text style={[styles.value, { color: colors.text }]}>
              Contratante: {nomes[item.artista_anfitriao_id] || 'Artista'}
            </Text>
            <Text style={[styles.value, { color: colors.text }]}>
              Artista: {nomes[item.artista_convidado_id] || 'Artista'}
            </Text>
            {item.funcao_participacao ? (
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                Função: {item.funcao_participacao}
              </Text>
            ) : null}
            {item.cache_valor != null && item.cache_valor > 0 ? (
              <Text style={[styles.value, { color: colors.text, marginTop: 6 }]}>
                Cachê:{' '}
                {item.cache_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {item.condicoes_pagamento?.trim() ||
                'Condições de pagamento: a combinar entre as partes. Sem multa automática no app.'}
            </Text>
            {item.respondido_em ? (
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                Confirmada em {formatCalendarDate(item.respondido_em)}
              </Text>
            ) : null}
          </View>

          {souParte ? (
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: colors.border }]}
              onPress={() =>
                openArtistChatInApp({
                  myArtistId: myId,
                  isAdmin: true,
                  otherArtistId: outroId,
                  otherArtistName: nomes[outroId],
                  showContext: {
                    nome: item.nome_evento,
                    data: formatCalendarDate(item.data_evento),
                    local,
                  },
                })
              }
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Conversar</Text>
            </TouchableOpacity>
          ) : null}

          {dataPassou && !cancelado && item.status_convite === 'aceito' ? (
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>O show aconteceu?</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                Contratante: {item.show_confirmado_anfitriao ? 'confirmou' : 'pendente'} · Artista:{' '}
                {item.show_confirmado_convidado ? 'confirmou' : 'pendente'}
              </Text>
              {jaConfirmeiShow ? (
                <Text style={[styles.meta, { color: colors.primary }]}>Você já confirmou a realização.</Text>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
                  disabled={saving}
                  onPress={() =>
                    void run(
                      () => confirmarRealizacaoContratacao(item.id),
                      'Confirmação registrada. A avaliação libera quando as duas partes confirmarem.'
                    )
                  }
                >
                  <Text style={styles.primaryBtnText}>Confirmar que o show aconteceu</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {podeAvaliar && !cancelado && souParte ? (
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Avaliar {nomes[outroId] || 'parceiro'}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>Nota geral</Text>
              <StarRow value={notaGeral} onChange={setNotaGeral} color={colors.primary} />
              <Text style={[styles.meta, { color: colors.textSecondary, marginTop: 10 }]}>
                {souAnfitriao ? 'Pontualidade' : 'Organização do evento'}
              </Text>
              <StarRow value={notaA} onChange={setNotaA} color={colors.primary} />
              <Text style={[styles.meta, { color: colors.textSecondary, marginTop: 10 }]}>
                {souAnfitriao ? 'Qualidade musical' : 'Clareza das informações'}
              </Text>
              <StarRow value={notaB} onChange={setNotaB} color={colors.primary} />
              <Text style={[styles.meta, { color: colors.textSecondary, marginTop: 10 }]}>
                {souAnfitriao ? 'Profissionalismo' : 'Estrutura e condições'}
              </Text>
              <StarRow value={notaC} onChange={setNotaC} color={colors.primary} />
              <Text style={[styles.meta, { color: colors.textSecondary, marginTop: 10 }]}>
                {souAnfitriao ? 'Comunicação' : 'Comunicação e profissionalismo'}
              </Text>
              <StarRow value={notaD} onChange={setNotaD} color={colors.primary} />
              <TextInput
                value={comentario}
                onChangeText={setComentario}
                placeholder="Comentário público (opcional)"
                placeholderTextColor={colors.textSecondary}
                multiline
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
                disabled={saving}
                onPress={() =>
                  void run(
                    () =>
                      avaliarParceiroContratacao({
                        conviteId: item.id,
                        notaGeral,
                        notaA: notaA || null,
                        notaB: notaB || null,
                        notaC: notaC || null,
                        notaD: notaD || null,
                        comentario,
                      }),
                    'Avaliação salva. Ela entra na média do perfil.'
                  )
                }
              >
                <Text style={styles.primaryBtnText}>Enviar avaliação</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {item.cancelamentos.length ? (
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Histórico de cancelamento</Text>
              {item.cancelamentos.map((c) => (
                <View key={c.id} style={{ marginTop: 8 }}>
                  <Text style={[styles.value, { color: colors.text }]}>
                    {c.status === 'pending'
                      ? 'Pendente'
                      : c.status === 'accepted'
                        ? 'Aceito'
                        : 'Contestado'}{' '}
                    · {c.motivo}
                  </Text>
                  {c.descricao ? (
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{c.descricao}</Text>
                  ) : null}
                  {c.pagamento_info ? (
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      Pagamento: {c.pagamento_info}
                    </Text>
                  ) : null}
                  {c.resposta_nota ? (
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      Resposta: {c.resposta_nota}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {euRespondo && pendente ? (
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Responder cancelamento</Text>
              <Text style={[styles.value, { color: colors.text }]}>{pendente.motivo}</Text>
              <TextInput
                value={respostaNota}
                onChangeText={setRespostaNota}
                placeholder="Nota (opcional)"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
                disabled={saving}
                onPress={() =>
                  void run(
                    () =>
                      responderCancelamentoContratacao({
                        solicitacaoId: pendente.id,
                        aceitar: true,
                        nota: respostaNota,
                      }),
                    'Cancelamento aceito. A data sai da agenda dos dois. O histórico permanece.'
                  )
                }
              >
                <Text style={styles.primaryBtnText}>Aceitar cancelamento</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outlineBtn, { borderColor: colors.error }]}
                disabled={saving}
                onPress={() =>
                  void run(
                    () =>
                      responderCancelamentoContratacao({
                        solicitacaoId: pendente.id,
                        aceitar: false,
                        nota: respostaNota,
                      }),
                    'Você contestou. A contratação fica em análise e a data permanece na agenda.'
                  )
                }
              >
                <Text style={[styles.outlineBtnText, { color: colors.error }]}>Contestar</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {podePedirCancel ? (
            <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Solicitar cancelamento</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                A outra parte precisa aceitar. Sem multa ou reembolso automático.
              </Text>
              <View style={styles.motivos}>
                {MOTIVOS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setMotivo(m)}
                    style={[
                      styles.motivoChip,
                      {
                        borderColor: motivo === m ? colors.primary : colors.border,
                        backgroundColor: motivo === m ? `${colors.primary}14` : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                value={descricao}
                onChangeText={setDescricao}
                placeholder="Descrição opcional"
                placeholderTextColor={colors.textSecondary}
                multiline
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                value={pagamento}
                onChangeText={setPagamento}
                placeholder="Adiantamento / pagamento (opcional)"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.error, opacity: saving ? 0.7 : 1 }]}
                disabled={saving}
                onPress={() =>
                  void run(
                    () =>
                      solicitarCancelamentoContratacao({
                        conviteId: item.id,
                        motivo,
                        descricao,
                        pagamentoInfo: pagamento,
                      }),
                    'Pedido enviado. A outra parte será avisada para aceitar ou contestar.'
                  )
                }
              >
                <Text style={styles.primaryBtnText}>Enviar pedido de cancelamento</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
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
  backBtn: { width: 40, padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '800' },
  meta: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 4 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  value: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    minHeight: 44,
  },
  primaryBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  outlineBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '800', fontSize: 14 },
  motivos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  motivoChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
});
