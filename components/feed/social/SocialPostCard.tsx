import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  alternarCurtidaSocialPost,
  removerSocialPost,
  type SocialPost,
} from '../../../services/supabase/socialFeedService';
import OptimizedImage from '../../OptimizedImage';
import FeedVideoPlayer from './FeedVideoPlayer';

type Props = {
  post: SocialPost;
  activeArtistId?: string | null;
  isMediaActive: boolean;
  onOpenComments?: (post: SocialPost) => void;
  onPostUpdated?: (post: SocialPost) => void;
  onPostRemoved?: (postId: string) => void;
};

function friendlySocialError(error: string | null | undefined, fallback: string): string {
  if (!error) return fallback;
  const text = error.toLowerCase();
  if (
    text.includes('does not exist') ||
    text.includes('não existe') ||
    text.includes('could not find the function') ||
    text.includes('schema cache') ||
    text.includes('pgrst202')
  ) {
    return 'Rode database/FEED_SOCIAL_PATCH_CURTIDAS.sql no Supabase (SQL Editor) e tente de novo.';
  }
  if (text.includes('sem permissão')) {
    return 'Você precisa ser colaborador do artista ativo para curtir.';
  }
  return error;
}

export default function SocialPostCard({
  post,
  activeArtistId,
  isMediaActive,
  onOpenComments,
  onPostUpdated,
  onPostRemoved,
}: Props) {
  const { colors } = useTheme();
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [liking, setLiking] = useState(false);

  useEffect(() => {
    setLiked(post.liked_by_me);
    setLikesCount(post.likes_count);
    setCommentsCount(post.comments_count);
  }, [post.id, post.liked_by_me, post.likes_count, post.comments_count]);

  const meuPost = !!activeArtistId && post.artist_id === activeArtistId;
  const isVideo = post.media_type === 'video';

  const syncPost = (patch: Partial<SocialPost>) => {
    onPostUpdated?.({
      ...post,
      liked_by_me: liked,
      likes_count: likesCount,
      comments_count: commentsCount,
      ...patch,
    });
  };

  const handleLike = async () => {
    if (!activeArtistId || liking) return;

    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !liked;
    const nextCount = nextLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    setLiked(nextLiked);
    setLikesCount(nextCount);
    setLiking(true);

    const { success, error, liked: serverLiked, likesCount: serverCount } =
      await alternarCurtidaSocialPost({
        postId: post.id,
        artistaId: activeArtistId,
      });

    setLiking(false);

    if (!success) {
      setLiked(prevLiked);
      setLikesCount(prevCount);
      Alert.alert('Curtir', friendlySocialError(error, 'Não foi possível curtir.'));
      return;
    }

    setLiked(!!serverLiked);
    setLikesCount(serverCount ?? nextCount);
    syncPost({
      liked_by_me: !!serverLiked,
      likes_count: serverCount ?? nextCount,
    });
  };

  const handleComment = () => {
    onOpenComments?.(post);
  };

  const handleRemove = () => {
    Alert.alert('Remover publicação', 'Ela sai do feed para todos.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { success, error } = await removerSocialPost(post.id);
            if (!success) {
              Alert.alert('Erro', error || 'Não foi possível remover.');
              return;
            }
            onPostRemoved?.(post.id);
          })();
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.avatarWrap, { backgroundColor: colors.secondary }]}
          onPress={() =>
            router.push({ pathname: '/perfil-artista', params: { artistId: post.artist_id } })
          }
          activeOpacity={0.8}
        >
          {post.artist_image ? (
            <OptimizedImage
              imageUrl={post.artist_image}
              style={styles.avatar}
              fallbackIcon="person"
              fallbackIconSize={20}
            />
          ) : (
            <Ionicons name="person" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <TouchableOpacity
            onPress={() =>
              router.push({ pathname: '/perfil-artista', params: { artistId: post.artist_id } })
            }
            activeOpacity={0.75}
          >
            <Text style={[styles.artistName, { color: colors.text }]} numberOfLines={1}>
              {post.artist_name}
            </Text>
          </TouchableOpacity>
          {post.location ? (
            <Text style={[styles.location, { color: colors.textSecondary }]} numberOfLines={1}>
              {post.location}
            </Text>
          ) : null}
        </View>
        {meuPost ? (
          <TouchableOpacity onPress={handleRemove} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {post.media_url ? (
        <View style={styles.media}>
          {isVideo ? (
            isMediaActive ? (
              <FeedVideoPlayer uri={post.media_url} isActive />
            ) : (
              <View style={styles.videoPlaceholder}>
                {post.thumbnail_url ? (
                  <Image
                    source={{ uri: post.thumbnail_url }}
                    style={styles.image}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : null}
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={22} color="#fff" />
                </View>
              </View>
            )
          ) : (
            <Image
              source={{ uri: post.media_url }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          )}
        </View>
      ) : null}

      <View style={styles.footer}>
        {post.body ? (
          <Text style={[styles.caption, { color: colors.text }]}>
            <Text style={[styles.captionName, { color: colors.text }]}>
              {post.artist_name}
            </Text>
            {'  '}
            {post.body}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={() => void handleLike()}
            disabled={!activeArtistId || liking}
            hitSlop={10}
            style={styles.actionItem}
            accessibilityLabel="Curtir"
          >
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={24}
              color={liked ? '#EF4444' : colors.text}
            />
            {likesCount > 0 ? (
              <Text style={[styles.actionCount, { color: colors.textSecondary }]}>
                {likesCount.toLocaleString('pt-BR')}
              </Text>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleComment}
            hitSlop={10}
            style={styles.actionItem}
            accessibilityLabel="Comentar"
          >
            <Ionicons name="chatbubble-outline" size={22} color={colors.text} />
            {commentsCount > 0 ? (
              <Text style={[styles.actionCount, { color: colors.textSecondary }]}>
                {commentsCount.toLocaleString('pt-BR')}
              </Text>
            ) : null}
          </TouchableOpacity>
        </View>

        {commentsCount > 0 ? (
          <TouchableOpacity onPress={handleComment} activeOpacity={0.7}>
            <Text style={[styles.viewComments, { color: colors.textSecondary }]}>
              {commentsCount === 1
                ? 'Ver 1 comentário'
                : `Ver todos os ${commentsCount} comentários`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  avatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  headerCopy: { flex: 1, minWidth: 0 },
  artistName: { fontSize: 15, fontWeight: '800' },
  location: { fontSize: 12, marginTop: 1 },
  media: { width: '100%', backgroundColor: '#000' },
  image: { width: '100%', aspectRatio: 1 },
  videoPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  caption: {
    fontSize: 14,
    lineHeight: 21,
  },
  captionName: {
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 12,
  },
  viewComments: {
    fontSize: 13,
    marginTop: -2,
  },
});
