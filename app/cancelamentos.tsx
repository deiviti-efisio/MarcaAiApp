import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatCityAndRegion } from '../lib/brazilGeo';
import { formatCalendarDate, toCalendarYmd, todayCalendarYmd } from '../lib/dateUtils';
import {
  isEventoParceriaCancelado,
  listarEventosParceriaArtista,
  type RegistroCancelamento,
} from '../services/supabase/contratacaoService';

type Aba = 'collabs' | 'parcerias';
type Periodo = 0 | 10 | 30 | 60;

function badgeOf(
  item: RegistroCancelamento
): { label: string; tone: 'error' | 'warning' | 'success' | 'muted' } {
  if (item.status_convite === 'pendente') {
    return { label: 'Em andamento', tone: 'warning' };
  }
  if (item.solicitacao_status === 'pending' || item.ciclo_status === 'cancellation_requested') {
    return { label: 'Pedido de cancelamento', tone: 'warning' };
  }
  if (item.solicitacao_status === 'contested' || item.ciclo_status === 'under_review') {
    return { label: 'Em análise', tone: 'warning' };
  }
  if (item.solicitacao_status === 'accepted' || item.ciclo_status === 'cancelled_by_mutual_agreement') {
    return { label: 'Cancelada', tone: 'error' };
  }
  if (item.status_convite === 'cancelado' || item.ciclo_status === 'cancelled') {
    return { label: 'Cancelada', tone: 'error' };
  }
  if (item.ciclo_status === 'completed') {
    return { label: 'Encerrada', tone: 'muted' };
  }
  const dataYmd = toCalendarYmd(item.data_evento);
  if (dataYmd && dataYmd < todayCalendarYmd()) {
    return { label: 'Encerrada', tone: 'muted' };
  }
  return { label: 'Em andamento', tone: 'warning' };
}

export default function EventosParceriaScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const params = useLocalSearchParams<{ aba?: string }>();
  const initialAba: Aba = params.aba === 'parcerias' ? 'parcerias' : 'collabs';
  const [aba, setAba] = useState<Aba>(initialAba);
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [itens, setItens] = useState<RegistroCancelamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeArtist?.id) {
      setItens([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const { itens: rows, error: err } = await listarEventosParceriaArtista(
      activeArtist.id,
      periodo || null,
      aba === 'parcerias' ? 'parceria' : 'collab'
    );
    setError(err);
    setItens(rows);
    setLoading(false);
    setRefreshing(false);
  }, [activeArtist?.id, periodo, aba]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const toneColor = (tone: 'error' | 'warning' | 'success' | 'muted') => {
    if (tone === 'warning') return colors.warning;
    if (tone === 'success') return colors.success;
    if (tone === 'muted') return colors.textSecondary;
    return colors.error;
  };

  const tabs: { id: Aba; label: string }[] = [
    { id: 'collabs', label: 'Collabs' },
    { id: 'parcerias', label: 'Parcerias' },
  ];
  const periodos: { id: Periodo; label: string }[] = [
    { id: 0, label: 'Todos' },
    { id: 10, label: '10d' },
    { id: 30, label: '30d' },
    { id: 60, label: '60d' },
  ];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          Eventos
        </Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.segmentWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {tabs.map((tab) => {
            const on = aba === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setAba(tab.id)}
                style={[styles.segment, on && { backgroundColor: colors.primary }]}
              >
                <Text
                  style={[styles.segmentText, { color: on ? '#fff' : colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.periodos}>
          {periodos.map((p) => {
            const on = periodo === p.id;
            return (
              <TouchableOpacity
                key={String(p.id)}
                onPress={() => setPeriodo(p.id)}
                style={[
                  styles.periodoChip,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? `${colors.primary}16` : colors.surface,
                  },
                ]}
              >
                <Text style={{ color: on ? colors.primary : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {!activeArtist ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>Selecione um artista em Configurações.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.error, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={itens}
          keyExtractor={(item) => item.convite_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          contentContainerStyle={itens.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="calendar-outline" size={44} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {aba === 'collabs' ? 'Nenhuma collab' : 'Nenhuma parceria'}
              </Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {aba === 'collabs'
                  ? 'Collabs de oportunidade (em andamento, encerradas ou canceladas) aparecem aqui.'
                  : 'Convites de participação em eventos já criados na agenda aparecem aqui.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const badge = badgeOf(item);
            const badgeColor = toneColor(badge.tone);
            const local = formatCityAndRegion({ city: item.cidade, state_uf: item.estado_uf });
            const parceiro =
              activeArtist.id === item.anfitriao_id ? item.convidado_nome : item.anfitriao_nome;
            const papel =
              aba === 'collabs'
                ? activeArtist.id === item.anfitriao_id
                  ? 'Você contratou'
                  : 'Você foi contratado'
                : activeArtist.id === item.anfitriao_id
                  ? 'Você convidou'
                  : 'Você foi convidado';
            const motivo = item.motivo || item.motivo_cancelamento;
            const cancelInfo = isEventoParceriaCancelado(item);
            return (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                activeOpacity={0.85}
                onPress={() =>
                  router.push({
                    pathname: '/contratacao',
                    params: { conviteId: item.convite_id, somenteLeitura: '1' },
                  })
                }
              >
                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={2}>
                  {item.nome_evento}
                </Text>
                <View style={styles.cardStatusRow}>
                  {item.data_evento ? (
                    <View style={[styles.dateBadge, { backgroundColor: `${colors.textSecondary}14` }]}>
                      <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.dateText, { color: colors.textSecondary }]}>
                        {formatCalendarDate(item.data_evento)}
                      </Text>
                    </View>
                  ) : <View />}
                  <View style={[styles.badge, { backgroundColor: `${badgeColor}18` }]}>
                    <Text style={[styles.badgeText, { color: badgeColor }]}>{badge.label}</Text>
                  </View>
                </View>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {item.hora_inicio ? String(item.hora_inicio).slice(0, 5) : ''}
                  {item.hora_inicio && local ? ' · ' : ''}
                  {local}
                </Text>
                <Text style={[styles.partner, { color: colors.text }]} numberOfLines={1}>
                  {papel} · {parceiro}
                </Text>
                {cancelInfo && (item.solicitado_por_nome || motivo) ? (
                  <View style={[styles.cancelBox, { backgroundColor: `${colors.error}12` }]}>
                    {item.solicitado_por_nome ? (
                      <Text style={[styles.cancelLine, { color: colors.text }]} numberOfLines={2}>
                        Pedido por {item.solicitado_por_nome}
                      </Text>
                    ) : null}
                    {motivo ? (
                      <Text style={[styles.cancelLine, { color: colors.text }]} numberOfLines={3}>
                        Motivo: {motivo}
                      </Text>
                    ) : null}
                    {item.resposta_nota ? (
                      <Text style={[styles.cancelNote, { color: colors.textSecondary }]} numberOfLines={3}>
                        Nota: {item.resposta_nota}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  segmentWrap: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  periodos: {
    flexDirection: 'row',
    marginTop: 10,
  },
  periodoChip: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    marginHorizontal: 3,
  },
  list: { paddingHorizontal: 16, paddingBottom: 28 },
  emptyList: { flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: '700' },
  emptySub: { marginTop: 8, textAlign: 'center', maxWidth: 300, lineHeight: 20, fontSize: 14 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
    marginBottom: 8,
  },
  cardName: { flex: 1, fontSize: 16, fontWeight: '700' },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  dateText: { fontSize: 11, fontWeight: '700' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  partner: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  cancelBox: { marginTop: 10, borderRadius: 10, padding: 10 },
  cancelLine: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  cancelNote: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
