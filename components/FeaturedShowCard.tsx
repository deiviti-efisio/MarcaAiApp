import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatCalendarDate } from '../lib/dateUtils';
import type { FeaturedShow } from '../services/supabase/eventService';

export default function FeaturedShowCard({
  show,
  colors,
}: {
  show: FeaturedShow;
  colors: { text: string; textSecondary: string; primary: string; surface: string; border: string };
}) {
  const place = [show.city, show.state_uf].filter(Boolean).join(' · ');
  const dateLabel = formatCalendarDate(show.event_date);
  const time = String(show.start_time || '').slice(0, 5);
  const timeLabel = time && time !== '00:00' ? time : '';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.media}>
        {show.highlight_image_url ? (
          <Image source={{ uri: show.highlight_image_url }} style={styles.mediaFill} contentFit="cover" />
        ) : (
          <View style={[styles.mediaFill, { backgroundColor: `${colors.primary}22` }]}>
            <Ionicons name="mic" size={42} color={colors.primary} />
          </View>
        )}
        <View style={styles.badge}>
          <Ionicons name="star" size={12} color="#fff" />
          <Text style={styles.badgeText}>Show especial</Text>
        </View>
      </View>
      <View style={styles.meta}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {show.name}
        </Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
          {[dateLabel, timeLabel, place].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  meta: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 4 },
});
