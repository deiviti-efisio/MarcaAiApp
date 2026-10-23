import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatEventLocationSlash } from '../lib/brazilGeo';
import { todayCalendarYmd } from '../lib/dateUtils';
import type { PublicAgendaEvent } from '../services/supabase/eventService';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const TAG_LABEL: Record<string, string> = {
  ensaio: 'Ensaio',
  evento: 'Show',
  reunião: 'Reunião',
};

function eventDateKey(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(value?: string | null): string {
  const hhmm = String(value || '').slice(0, 5);
  if (!hhmm || hhmm === '00:00') return '';
  return hhmm;
}

function formatTimeRange(start?: string | null, end?: string | null): string {
  const from = formatClock(start);
  const to = formatClock(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

export default function PublicAgendaCalendar({
  events,
  colors,
}: {
  events: PublicAgendaEvent[];
  colors: {
    text: string;
    textSecondary: string;
    primary: string;
    surface: string;
    border: string;
    background: string;
    secondary?: string;
  };
}) {
  const now = new Date();
  const viewYear = now.getFullYear();
  const viewMonth = now.getMonth();
  const today = todayCalendarYmd();
  const [selected, setSelected] = useState(today);

  const eventsByDate = useMemo(() => {
    const map: Record<string, PublicAgendaEvent[]> = {};
    events.forEach((item) => {
      const dateKey = eventDateKey(item.event_date);
      if (!dateKey) return;
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(item);
    });
    return map;
  }, [events]);

  const calendarMatrix = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const firstWeekDay = firstDayOfMonth.getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const weeks: ({ dayNumber: number; dateString: string } | null)[][] = [];

    let dayCounter = 1 - firstWeekDay;
    while (dayCounter <= totalDays) {
      const week: ({ dayNumber: number; dateString: string } | null)[] = [];
      for (let i = 0; i < 7; i += 1) {
        const currentDay = dayCounter + i;
        if (currentDay < 1 || currentDay > totalDays) {
          week.push(null);
        } else {
          week.push({
            dayNumber: currentDay,
            dateString: `${viewYear}-${pad2(viewMonth + 1)}-${pad2(currentDay)}`,
          });
        }
      }
      weeks.push(week);
      dayCounter += 7;
    }

    return weeks;
  }, [viewMonth, viewYear]);

  const selectedEvents = eventsByDate[selected] || [];
  const monthPrefix = `${viewYear}-${pad2(viewMonth + 1)}`;
  const monthEvents = useMemo(
    () => events.filter((item) => eventDateKey(item.event_date).startsWith(monthPrefix)),
    [events, monthPrefix]
  );
  const todayEvents = eventsByDate[today] || [];
  const otherSelected = selected === today ? [] : selectedEvents;

  const renderEventCard = (item: PublicAgendaEvent) => {
    const dateKey = eventDateKey(item.event_date);
    const [y, m, d] = dateKey.split('-').map(Number);
    const localDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
      ? new Date(y, m - 1, d)
      : null;
    const weekLabel = localDate ? WEEKDAY_LABELS[localDate.getDay()] : '';
    const time = formatTimeRange(item.start_time, item.end_time);
    const place = formatEventLocationSlash(item);
    const tag = TAG_LABEL[String(item.tag || '').toLowerCase()] || '';
    const isTodayShow = dateKey === today;
    return (
      <View
        key={item.id}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={[styles.dateBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.dateBadgeDay}>{localDate ? String(localDate.getDate()) : ''}</Text>
          <Text style={styles.dateBadgeWeek}>{isTodayShow ? 'hoje' : weekLabel.toLowerCase()}</Text>
        </View>
        <View style={styles.cardBody}>
          {isTodayShow ? (
            <Text style={[styles.tag, { color: colors.primary }]}>Show hoje</Text>
          ) : tag ? (
            <Text style={[styles.tag, { color: colors.primary }]}>{tag}</Text>
          ) : null}
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          {time ? (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{time}</Text>
            </View>
          ) : null}
          {place ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
                {place}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View>
      <Text style={[styles.info, { color: colors.textSecondary }]}>
        Datas que o artista deixou públicas.
      </Text>

      {todayEvents.length > 0 ? (
        <View style={[styles.listWrap, { marginBottom: 16 }]}>{todayEvents.map(renderEventCard)}</View>
      ) : null}

      <View style={[styles.calCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.calHead}>
          <Text style={[styles.monthTitle, { color: colors.text }]}>
            {MONTHS[viewMonth]} {viewYear}
          </Text>
        </View>

        <View style={styles.calendarHeaderRow}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={[styles.calendarHeaderText, { color: colors.textSecondary }]}>
              {label}
            </Text>
          ))}
        </View>

        {calendarMatrix.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.calendarWeekRow}>
            {week.map((day, dayIndex) => {
              if (!day) {
                return <View key={`empty-${weekIndex}-${dayIndex}`} style={styles.calendarDayCell} />;
              }

              const dayEvents = eventsByDate[day.dateString] || [];
              const hasEvents = dayEvents.length > 0;
              const isToday = day.dateString === today;
              const isSelected = selected === day.dateString;

              return (
                <TouchableOpacity
                  key={day.dateString}
                  style={[
                    styles.calendarDayCell,
                    isToday && { borderColor: colors.primary, borderWidth: 1.5 },
                    hasEvents && { backgroundColor: colors.secondary || `${colors.primary}18` },
                    isSelected && { backgroundColor: `${colors.primary}22` },
                  ]}
                  onPress={() => setSelected(day.dateString)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.calendarDayText,
                      { color: hasEvents ? colors.text : colors.textSecondary },
                      isToday && styles.calendarDayTodayText,
                    ]}
                  >
                    {day.dayNumber}
                  </Text>
                  {hasEvents ? (
                    <View style={styles.eventIndicatorsRow}>
                      {Array.from({ length: Math.min(dayEvents.length, 3) }).map((_, dotIndex) => (
                        <View
                          key={`${day.dateString}-dot-${dotIndex}`}
                          style={[styles.eventIndicator, { backgroundColor: colors.primary }]}
                        />
                      ))}
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.listWrap}>
        {otherSelected.length > 0
          ? otherSelected.map(renderEventCard)
          : todayEvents.length === 0
            ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {events.length === 0
                ? 'Nenhuma data pública neste momento.'
                : monthEvents.length === 0
                  ? 'Nenhuma data pública neste mês.'
                  : 'Toque numa data marcada para ver o compromisso.'}
            </Text>
          </View>
              )
            : selected !== today
              ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Toque numa data marcada para ver o compromisso.
            </Text>
          </View>
              )
            : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  info: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
    paddingRight: 20,
  },
  calCard: {
    marginRight: 20,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 16,
  },
  calHead: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  monthTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  calendarHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  calendarDayCell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  calendarDayText: {
    fontSize: 16,
    fontWeight: '600',
  },
  calendarDayTodayText: {
    fontWeight: '700',
  },
  eventIndicatorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 4,
    minHeight: 6,
  },
  eventIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  listWrap: { paddingRight: 20, gap: 10 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateBadge: {
    width: 52,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBadgeDay: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  dateBadgeWeek: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    marginTop: 1,
  },
  cardBody: { flex: 1, minWidth: 0 },
  tag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 21 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  metaText: { fontSize: 13, flex: 1 },
  emptyBox: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
