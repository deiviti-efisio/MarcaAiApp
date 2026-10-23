import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
import OptimizedImage from '../components/OptimizedImage';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  listarConversasArtista,
  subscribeConversasRealtime,
  type ConversaResumo,
} from '../services/supabase/conversaArtistaService';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function ConversasScreen() {
  const { colors } = useTheme();
  const { isAdmin } = usePermissions();
  const { activeArtist } = useActiveArtistContext();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeArtist?.id) {
      setConversas([]);
      setLoading(false);
      return;
    }
    const res = await listarConversasArtista(activeArtist.id);
    setConversas(res.conversas);
    setError(res.error);
    setLoading(false);
    setRefreshing(false);
  }, [activeArtist?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (!activeArtist?.id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeConversasRealtime({
      meuArtistaId: activeArtist.id,
      onChange: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void load();
        }, 250);
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [activeArtist?.id, load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.text }]}>Conversas</Text>
        <View style={styles.iconBtn} />
      </View>

      {!isAdmin ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
            Somente o administrador pode conversar com outros artistas.
          </Text>
        </View>
      ) : !activeArtist?.id ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
            Selecione um artista para ver as conversas.
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={conversas}
          keyExtractor={(item) => item.conversationId}
          contentContainerStyle={conversas.length === 0 ? styles.emptyList : styles.list}
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
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: colors.border }]} />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="chatbubbles-outline" size={42} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Nenhuma conversa ainda</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {error || 'Toque em Conversar no perfil de um artista para começar.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const initial = item.otherArtistName.trim().charAt(0).toUpperCase() || '?';
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: '/conversa',
                    params: {
                      conversationId: item.conversationId,
                      artistId: item.otherArtistId,
                      artistName: item.otherArtistName,
                      artistImage: item.otherArtistImage || '',
                    },
                  })
                }
                activeOpacity={0.85}
              >
                {item.otherArtistImage ? (
                  <OptimizedImage
                    imageUrl={item.otherArtistImage}
                    style={styles.avatar}
                    fallbackText={initial}
                    fallbackIconSize={18}
                    showLoadingIndicator={false}
                  />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: `${colors.primary}22` }]}>
                    <Text style={[styles.avatarLetter, { color: colors.primary }]}>{initial}</Text>
                  </View>
                )}
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {item.otherArtistName}
                    </Text>
                    <Text style={[styles.when, { color: colors.textSecondary }]}>
                      {formatWhen(item.lastMessageAt)}
                    </Text>
                  </View>
                  <View style={styles.rowTop}>
                    <Text
                      style={[
                        styles.preview,
                        { color: item.unreadCount > 0 ? colors.text : colors.textSecondary },
                        item.unreadCount > 0 && styles.previewUnread,
                      ]}
                      numberOfLines={1}
                    >
                      {item.lastMessage || 'Diga olá'}
                    </Text>
                    {item.unreadCount > 0 ? (
                      <View style={[styles.unread, { backgroundColor: colors.primary }]}>
                        <Text style={styles.unreadText}>
                          {item.unreadCount > 99 ? '99+' : String(item.unreadCount)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 82 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: { fontSize: 20, fontWeight: '700' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '700' },
  when: { fontSize: 12 },
  preview: { flex: 1, fontSize: 14, marginTop: 3 },
  previewUnread: { fontWeight: '700' },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 12 },
  emptySub: { fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
