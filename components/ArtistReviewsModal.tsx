import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import OptimizedImage from './OptimizedImage';
import { useTheme } from '../contexts/ThemeContext';
import {
  listarAvaliacoesPublicasArtistaParaConvite,
  type AvaliacaoPublicaArtistaConvite,
} from '../services/supabase/conviteParticipacaoEventoService';

type Props = {
  visible: boolean;
  artistId: string | null;
  artistName: string;
  artistImage?: string | null;
  onClose: () => void;
};

function formatReviewDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ArtistReviewsModal({
  visible,
  artistId,
  artistName,
  artistImage,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<AvaliacaoPublicaArtistaConvite[]>([]);

  useEffect(() => {
    if (!visible || !artistId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { avaliacoes, error: err } = await listarAvaliacoesPublicasArtistaParaConvite(artistId, 40);
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err);
        setReviews([]);
        return;
      }
      setReviews(avaliacoes);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, artistId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>Avaliações</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.artistRow}>
            <OptimizedImage
              imageUrl={artistImage || ''}
              style={styles.avatar}
              fallbackText={artistName}
            />
            <View>
              <Text style={[styles.artistName, { color: colors.text }]}>{artistName}</Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>
                Comentários de quem contratou
              </Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
          ) : error ? (
            <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          ) : reviews.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              Nenhuma avaliação pública ainda.
            </Text>
          ) : (
            <FlatList
              data={reviews}
              keyExtractor={(item, idx) => `${item.artista_avaliador_id}-${item.criado_em}-${idx}`}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <View style={[styles.reviewCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={styles.reviewTop}>
                    <OptimizedImage
                      imageUrl={item.artista_avaliador_imagem || ''}
                      style={styles.reviewerAvatar}
                      fallbackText={item.artista_avaliador_nome || 'Artista'}
                      fallbackIcon="person"
                      fallbackIconSize={14}
                      fallbackIconColor={colors.primary}
                      showLoadingIndicator={false}
                    />
                    <View style={styles.reviewerInfo}>
                      <Text style={[styles.reviewer, { color: colors.text }]} numberOfLines={1}>
                        {item.artista_avaliador_nome}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>
                        {formatReviewDate(item.criado_em)}
                      </Text>
                    </View>
                    <Text style={styles.stars}>
                      {'★'.repeat(Math.max(1, Math.min(5, item.nota_geral)))}
                      {'☆'.repeat(Math.max(0, 5 - Math.max(1, Math.min(5, item.nota_geral))))}
                    </Text>
                  </View>
                  {item.comentario_publico ? (
                    <Text style={[styles.comment, { color: colors.text }]}>
                      {item.comentario_publico}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    maxHeight: '85%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  artistName: {
    fontSize: 16,
    fontWeight: '700',
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  reviewCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  reviewerInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  reviewer: {
    fontWeight: '700',
    fontSize: 15,
  },
  stars: {
    color: '#F59E0B',
    fontSize: 13,
  },
  comment: {
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    fontSize: 11,
    marginTop: 8,
  },
  empty: {
    textAlign: 'center',
    padding: 24,
    fontSize: 14,
  },
  error: {
    textAlign: 'center',
    padding: 24,
    fontSize: 14,
  },
});
