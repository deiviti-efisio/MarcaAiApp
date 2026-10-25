import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../contexts/ThemeContext';
import { formatCalendarDate } from '../lib/dateUtils';
import {
  listarHistoricoParticipacaoParceiro,
  type HistoricoParticipacaoParceiroItem,
  type ParceiroFrequenteParticipacao,
} from '../services/supabase/conviteParticipacaoEventoService';
import { buildWhatsAppUrl } from '../utils/brazilPhone';
import OptimizedImage from './OptimizedImage';

const SCREEN_W = Dimensions.get('window').width;
export const MAX_ROWS_SHARE = 28;

function PodiumRankVisual({ index, compact }: { index: number; compact?: boolean }) {
  const crownSize = compact ? 24 : 26;
  const medalSize = compact ? 22 : 24;
  if (index === 0) return <MaterialCommunityIcons name="crown" size={crownSize} color="#CA8A04" />;
  if (index === 1) return <MaterialCommunityIcons name="medal" size={medalSize} color="#94A3B8" />;
  if (index === 2) return <MaterialCommunityIcons name="medal" size={medalSize} color="#B45309" />;
  return (
    <Text style={{ fontSize: compact ? 13 : 14, fontWeight: '800', color: '#6B7280', minWidth: 20, textAlign: 'center' }}>
      {index + 1}
    </Text>
  );
}

function partnerSubtitleForShare(item: ParceiroFrequenteParticipacao): string {
  const funcoes =
    item.funcoesParticipacao.length > 0
      ? item.funcoesParticipacao.join(' · ')
      : item.ultima_funcao;
  const lines: string[] = [];
  if (funcoes) {
    lines.push(item.funcoesParticipacao.length > 1 ? `Funções: ${funcoes}` : `Função: ${funcoes}`);
  }
  if (item.participacao_data_evento) {
    lines.push(`Último show: ${formatCalendarDate(item.participacao_data_evento)}`);
  }
  return lines.join('\n');
}

export function ShareCapture({
  partners,
  artistName,
  totalInApp,
}: {
  partners: ParceiroFrequenteParticipacao[];
  artistName: string;
  totalInApp: number;
}) {
  const now = new Date();
  const footer = `Gerado em ${now.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · MeuShow`;
  const omitted = totalInApp > partners.length ? totalInApp - partners.length : 0;
  return (
    <View style={shareStyles.sheet} collapsable={false}>
      <Text style={shareStyles.title}>Parceiros frequentes</Text>
      <Text style={shareStyles.subtitle}>Perfil: {artistName}</Text>
      <Text style={shareStyles.caption}>Convites de participação aceitos neste perfil.</Text>
      {omitted > 0 ? (
        <Text style={shareStyles.omitted}>
          Imagem com os primeiros {partners.length}; mais {omitted} no app.
        </Text>
      ) : null}
      {partners.map((item, index) => {
        const uri = (item.image_url || item.profile_url || '').trim();
        const sub = partnerSubtitleForShare(item);
        return (
          <View key={item.id} style={shareStyles.row}>
            <View style={shareStyles.rankIconWrap}>
              <PodiumRankVisual index={index} compact />
            </View>
            {uri ? (
              <Image source={{ uri }} style={shareStyles.avatar} />
            ) : (
              <View style={[shareStyles.avatar, shareStyles.avatarFallback]}>
                <Text style={shareStyles.avatarLetter}>{(item.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={shareStyles.rowBody}>
              <Text style={shareStyles.name} numberOfLines={2}>
                {item.name}
              </Text>
              {sub ? (
                <Text style={shareStyles.detail} numberOfLines={5}>
                  {sub}
                </Text>
              ) : null}
            </View>
            <View style={shareStyles.badge}>
              <Text style={shareStyles.badgeNum}>{item.totalParticipacoesAceitas}</Text>
              <Text style={shareStyles.badgeLbl}>
                {item.totalParticipacoesAceitas === 1 ? 'show' : 'shows'}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={shareStyles.footer}>{footer}</Text>
    </View>
  );
}

type Props = {
  artistId: string;
  partners: ParceiroFrequenteParticipacao[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
};

export async function compartilharParceirosFrequentes(node: View | null, empty: boolean) {
  if (empty) {
    Alert.alert('Lista vazia', 'Não há parceiros para compartilhar.');
    return;
  }
  if (!node) {
    Alert.alert('Aguarde', 'Tente compartilhar novamente em instantes.');
    return;
  }
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 450 : 350));
  const uri = await captureRef(node, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    snapshotContentContainer: false,
  });
  const ok = await Sharing.isAvailableAsync();
  if (!ok) {
    Alert.alert('Indisponível', 'Compartilhamento não está disponível neste dispositivo.');
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Compartilhar parceiros frequentes',
  });
}

export default function ParceirosFrequentesPanel({
  artistId,
  partners,
  loading,
  error,
  refreshing,
  onRefresh,
}: Props) {
  const { colors } = useTheme();
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);
  const [historyByPartner, setHistoryByPartner] = useState<Record<string, HistoricoParticipacaoParceiroItem[]>>({});
  const [historyLoadingByPartner, setHistoryLoadingByPartner] = useState<Record<string, boolean>>({});

  const openWhatsapp = useCallback(async (phone: string | null | undefined) => {
    const url = buildWhatsAppUrl(phone);
    if (!url) {
      Alert.alert('WhatsApp indisponível', 'Número de WhatsApp inválido para este parceiro.');
      return;
    }
    const digits = String(phone || '').replace(/\D/g, '');
    const phoneIntl = digits.startsWith('55') ? digits : `55${digits}`;
    try {
      await Linking.openURL(`whatsapp://send?phone=${phoneIntl}`);
    } catch {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert('Erro', 'Não foi possível abrir a conversa no WhatsApp.');
      }
    }
  }, []);

  const toggleExpand = useCallback(
    async (partner: ParceiroFrequenteParticipacao) => {
      const next = expandedPartnerId === partner.id ? null : partner.id;
      setExpandedPartnerId(next);
      if (!next || historyByPartner[partner.id] || historyLoadingByPartner[partner.id]) return;
      setHistoryLoadingByPartner((prev) => ({ ...prev, [partner.id]: true }));
      const { eventos } = await listarHistoricoParticipacaoParceiro(artistId, partner.id, 25);
      setHistoryByPartner((prev) => ({ ...prev, [partner.id]: eventos }));
      setHistoryLoadingByPartner((prev) => ({ ...prev, [partner.id]: false }));
    },
    [artistId, expandedPartnerId, historyByPartner, historyLoadingByPartner]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.error, textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={partners}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={partners.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="people-outline" size={44} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Nenhum parceiro ainda</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              Quem aceitar participação nos seus shows aparece aqui, ordenado por quantidade de parcerias.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const img = item.image_url || item.profile_url || '';
          const funcoes =
            item.funcoesParticipacao.length > 0
              ? item.funcoesParticipacao.join(' · ')
              : item.ultima_funcao;
          const isExpanded = expandedPartnerId === item.id;
          const history = historyByPartner[item.id] || [];
          const historyLoading = historyLoadingByPartner[item.id] === true;
          const showWhatsapp = item.show_whatsapp === true && String(item.whatsapp || '').trim().length > 0;
          return (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => void toggleExpand(item)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.cardTop}>
                <View style={styles.rank}>{<PodiumRankVisual index={index} />}</View>
                <OptimizedImage
                  imageUrl={img}
                  style={styles.avatar}
                  cacheKey={`freq_partner_${item.id}`}
                  fallbackText={item.name}
                  fallbackIcon="person"
                  fallbackIconSize={20}
                  fallbackIconColor={colors.primary}
                  showLoadingIndicator={false}
                />
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {showWhatsapp ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          void openWhatsapp(item.whatsapp);
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {funcoes ? (
                    <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                      {funcoes}
                    </Text>
                  ) : null}
                  {item.participacao_data_evento ? (
                    <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                      Último show {formatCalendarDate(item.participacao_data_evento)}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.count, { backgroundColor: `${colors.primary}16` }]}>
                  <Text style={[styles.countNum, { color: colors.primary }]}>
                    {item.totalParticipacoesAceitas}
                  </Text>
                  <Text style={[styles.countLbl, { color: colors.textSecondary }]}>
                    {item.totalParticipacoesAceitas === 1 ? 'show' : 'shows'}
                  </Text>
                </View>
              </View>
              {isExpanded ? (
                <View style={[styles.expanded, { borderTopColor: colors.border }]}>
                  <Text style={[styles.expandedTitle, { color: colors.text }]}>Shows juntos</Text>
                  {historyLoading ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : history.length === 0 ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Sem histórico detalhado.</Text>
                  ) : (
                    history.map((ev) => (
                      <View key={ev.conviteId} style={styles.histRow}>
                        <Text style={[styles.histName, { color: colors.text }]} numberOfLines={2}>
                          {ev.nomeEvento}
                        </Text>
                        <Text style={[styles.histMeta, { color: colors.textSecondary }]}>
                          {formatCalendarDate(ev.dataEvento)}
                          {ev.funcaoParticipacao ? ` · ${ev.funcaoParticipacao}` : ''}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyList: { flexGrow: 1 },
  emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: '800' },
  emptySub: { marginTop: 8, textAlign: 'center', maxWidth: 300, lineHeight: 20, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 28 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  rank: { width: 28, alignItems: 'center', flexShrink: 0 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginLeft: 6, flexShrink: 0 },
  body: { flex: 1, marginLeft: 12, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', marginRight: 6 },
  sub: { fontSize: 12, marginTop: 2 },
  count: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 48,
    marginLeft: 6,
    flexShrink: 0,
  },
  countNum: { fontSize: 16, fontWeight: '800' },
  countLbl: { fontSize: 10, fontWeight: '600' },
  expanded: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  expandedTitle: { fontSize: 12, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  histRow: { marginBottom: 8 },
  histName: { fontSize: 13, fontWeight: '700' },
  histMeta: { fontSize: 12, marginTop: 2 },
});

const shareStyles = StyleSheet.create({
  sheet: { width: SCREEN_W, backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 15, fontWeight: '600', color: '#4B5563', marginBottom: 4 },
  caption: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  omitted: { fontSize: 11, color: '#7C3AED', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  rankIconWrap: { width: 34, alignItems: 'center', paddingTop: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F3F4F6' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '700', color: '#7C3AED' },
  rowBody: { flex: 1, marginLeft: 10, marginRight: 8, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  detail: { fontSize: 12, color: '#4B5563', marginTop: 4, lineHeight: 16 },
  badge: {
    alignItems: 'center',
    minWidth: 52,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#EDE9FE',
    marginTop: 4,
  },
  badgeNum: { fontSize: 16, fontWeight: '700', color: '#5B21B6' },
  badgeLbl: { fontSize: 10, color: '#6B7280', marginTop: 2 },
  footer: { marginTop: 16, fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
});
