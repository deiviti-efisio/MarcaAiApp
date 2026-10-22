import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OptimizedImage from '../components/OptimizedImage';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  abrirConversaArtistas,
  enviarMensagemConversa,
  listarMensagensConversa,
  marcarConversaLida,
  subscribeConversasRealtime,
  type MensagemConversa,
} from '../services/supabase/conversaArtistaService';

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ConversaScreen() {
  const { colors } = useTheme();
  const { activeArtist } = useActiveArtistContext();
  const params = useLocalSearchParams<{
    conversationId?: string;
    artistId?: string;
    artistName?: string;
    artistImage?: string;
  }>();
  const otherId = typeof params.artistId === 'string' ? params.artistId : '';
  const [conversationId, setConversationId] = useState(
    typeof params.conversationId === 'string' ? params.conversationId : ''
  );
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<MensagemConversa>>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = (typeof params.artistName === 'string' && params.artistName) || 'Conversa';
  const image = typeof params.artistImage === 'string' ? params.artistImage : '';
  const initial = title.trim().charAt(0).toUpperCase() || '?';
  const canChat = !!activeArtist?.id && !!otherId && activeArtist.id !== otherId;

  const loadThread = useCallback(
    async (id: string, silent = false) => {
      if (!activeArtist?.id || !id) return;
      if (!silent) setLoading(true);
      const res = await listarMensagensConversa({
        conversationId: id,
        meuArtistaId: activeArtist.id,
      });
      setMensagens(res.mensagens);
      setLoading(false);
      void marcarConversaLida(id, activeArtist.id);
    },
    [activeArtist?.id]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!canChat || !activeArtist?.id) {
        setLoading(false);
        return;
      }
      let id = conversationId;
      if (!id) {
        const opened = await abrirConversaArtistas(activeArtist.id, otherId);
        if (cancelled) return;
        if (!opened.conversationId) {
          setLoading(false);
          Alert.alert('Conversa', opened.error || 'Não foi possível abrir o bate-papo.');
          return;
        }
        id = opened.conversationId;
        setConversationId(id);
      }
      await loadThread(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeArtist?.id, canChat, conversationId, loadThread, otherId]);

  useEffect(() => {
    if (!conversationId || !activeArtist?.id) return;
    const unsubscribe = subscribeConversasRealtime({
      meuArtistaId: activeArtist.id,
      conversationId,
      onChange: () => {
        if (pollRef.current) clearTimeout(pollRef.current);
        pollRef.current = setTimeout(() => {
          void loadThread(conversationId, true);
        }, 200);
      },
    });
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      unsubscribe();
    };
  }, [activeArtist?.id, conversationId, loadThread]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !conversationId || !activeArtist?.id || sending) return;
    setSending(true);
    const temp: MensagemConversa = {
      id: `tmp-${Date.now()}`,
      senderArtistId: activeArtist.id,
      body,
      createdAt: new Date().toISOString(),
      isMine: true,
    };
    setMensagens((prev) => [...prev, temp]);
    setDraft('');
    const res = await enviarMensagemConversa({
      conversationId,
      meuArtistaId: activeArtist.id,
      body,
    });
    setSending(false);
    if (res.error) {
      setMensagens((prev) => prev.filter((m) => m.id !== temp.id));
      setDraft(body);
      Alert.alert('Mensagem', res.error);
      return;
    }
    await loadThread(conversationId, true);
  };

  const data = useMemo(() => mensagens, [mensagens]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.peer}
          onPress={() => {
            if (otherId) router.push({ pathname: '/perfil-artista', params: { artistId: otherId } });
          }}
          activeOpacity={0.8}
        >
          {image ? (
            <OptimizedImage
              imageUrl={image}
              style={styles.peerAvatar}
              fallbackText={initial}
              fallbackIconSize={14}
              showLoadingIndicator={false}
            />
          ) : (
            <View style={[styles.peerAvatar, { backgroundColor: `${colors.primary}22` }]}>
              <Text style={[styles.peerLetter, { color: colors.primary }]}>{initial}</Text>
            </View>
          )}
          <Text style={[styles.peerName, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        </TouchableOpacity>
        <View style={styles.iconBtn} />
      </View>

      {!canChat ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 28 }}>
            Selecione um artista para conversar.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={data}
              keyExtractor={(item) => item.id}
              contentContainerStyle={data.length === 0 ? styles.emptyList : styles.messages}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
                    Envie a primeira mensagem.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.bubbleRow, item.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <View
                    style={[
                      styles.bubble,
                      item.isMine
                        ? { backgroundColor: colors.primary }
                        : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: item.isMine ? '#fff' : colors.text }]}>
                      {item.body}
                    </Text>
                    <Text style={[styles.bubbleTime, { color: item.isMine ? 'rgba(255,255,255,0.75)' : colors.textSecondary }]}>
                      {formatMsgTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              )}
            />
          )}

          <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={draft}
              onChangeText={setDraft}
              placeholder="Mensagem..."
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.send, { backgroundColor: colors.primary, opacity: draft.trim() ? 1 : 0.45 }]}
              onPress={() => void send()}
              disabled={!draft.trim() || sending}
            >
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  peerAvatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  peerLetter: { fontSize: 14, fontWeight: '700' },
  peerName: { flex: 1, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messages: { paddingHorizontal: 12, paddingVertical: 16, gap: 8 },
  emptyList: { flexGrow: 1 },
  bubbleRow: { maxWidth: '82%' },
  bubbleMine: { alignSelf: 'flex-end' },
  bubbleTheirs: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
