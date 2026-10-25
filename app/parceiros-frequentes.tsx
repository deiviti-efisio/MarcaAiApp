import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ParceirosFrequentesPanel, {
  compartilharParceirosFrequentes,
  MAX_ROWS_SHARE,
  ShareCapture,
} from '../components/ParceirosFrequentesPanel';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import { listarParceirosFrequentesParticipacao } from '../services/supabase/conviteParticipacaoEventoService';
import type { ParceiroFrequenteParticipacao } from '../services/supabase/conviteParticipacaoEventoService';

const SCREEN_W = Dimensions.get('window').width;

export default function ParceirosFrequentesScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const [partners, setPartners] = useState<ParceiroFrequenteParticipacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareCaptureRef = useRef<View>(null);

  const load = useCallback(async () => {
    if (!activeArtist?.id) {
      setPartners([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const { partners: list, error: err } = await listarParceirosFrequentesParticipacao(
      activeArtist.id,
      40
    );
    setError(err);
    setPartners(list);
    setLoading(false);
    setRefreshing(false);
  }, [activeArtist?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const onShare = async () => {
    try {
      setSharing(true);
      await compartilharParceirosFrequentes(shareCaptureRef.current, partners.length === 0);
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar ou compartilhar a imagem.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Parcerias frequentes</Text>
          {partners.length > 0 ? (
            <TouchableOpacity onPress={() => void onShare()} style={styles.backBtn} disabled={sharing}>
              {sharing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="share-outline" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Artistas que mais aceitaram participar em eventos do perfil {activeArtist?.name ?? 'atual'}.
        </Text>
        {!activeArtist ? (
          <View style={styles.center}>
            <Text style={{ color: colors.textSecondary }}>Selecione um artista em Configurações.</Text>
          </View>
        ) : (
          <ParceirosFrequentesPanel
            artistId={activeArtist.id}
            partners={partners}
            loading={loading}
            error={error}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        )}
      </SafeAreaView>
      {activeArtist?.name && partners.length > 0 ? (
        <View ref={shareCaptureRef} collapsable={false} pointerEvents="none" style={styles.shareHost}>
          <ShareCapture
            partners={partners.slice(0, MAX_ROWS_SHARE)}
            artistName={activeArtist.name}
            totalInApp={partners.length}
          />
        </View>
      ) : null}
    </View>
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
  hint: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  shareHost: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    opacity: 0.02,
    zIndex: -1,
  },
});
