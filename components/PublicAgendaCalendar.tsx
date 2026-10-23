import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatEventLocationSlash } from '../lib/brazilGeo';
import { toCalendarYmd, todayCalendarYmd, weekdayFromCalendarDate } from '../lib/dateUtils';
import type { PublicAgendaEvent } from '../services/supabase/eventService';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
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

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const part = toCalendarYmd(value);
  const bits = part.split('-');
  if (bits.length < 3) return null;
  const y = Number(bits[0]);
  const m = Number(bits[1]);
  const d = Number(bits[2]);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
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

function weekdayShort(date: string): string {
  const full = weekdayFromCalendarDate(date);
  return full ? full.slice(0, 3).toLowerCase() : '';
}

function dayNumber(date: string): string {
  const parsed = parseYmd(date);
  return parsed ? String(parsed.d) : '';
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
  };
}) {
  const now = new Date();
  const viewYear = now.getFullYear();
  const viewMonth = now.getMonth();
  const today = todayCalendarYmd();
  const [selected, setSelected] = useState(today);

  const byDate = useMemo(() => {
    const map = new Map<string, PublicAgendaEvent[]>();
    events.forEach((item) => {
      const key = toCalendarYmd(item.event_date);
      if (!key) return;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: { key: string; day?: number; date?: string }[] = [];
    for (let i = 0; i < startPad; i += 1) {
      out.push({ key: `pad-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = ymd(viewYear, viewMonth, day);
      out.push({ key: date, day, date });
    }
    while (out.length % 7 !== 0) {
      out.push({ key: `end-${out.length}` });
    }
    return out;
  }, [viewMonth, viewYear]);

  const selectedEvents = byDate.get(selected) ?? [];
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const monthEvents = useMemo(
    () => events.filter((item) => toCalendarYmd(item.event_date).startsWith(monthPrefix)),
    [events, monthPrefix]
  );

  const todayEvents = byDate.get(today) ?? [];
  const otherSelected =
    selected === today
      ? []
      : selectedEvents.filter((item) => toCalendarYmd(item.event_date) !== today);

  const renderEventCard = (item: PublicAgendaEvent) => {
    const dateKey = toCalendarYmd(item.event_date);
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
          <Text style={styles.dateBadgeDay}>{dayNumber(dateKey)}</Text>
          <Text style={styles.dateBadgeWeek}>{isTodayShow ? 'hoje' : weekdayShort(dateKey)}</Text>
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

        <View style={styles.weekRow}>
          {WEEKDAYS.map((label, idx) => (
            <Text key={`${label}-${idx}`} style={[styles.weekLabel, { color: colors.textSecondary }]}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((cell) => {
            const marked = !!cell.date && byDate.has(cell.date);
            const isSelected = !!cell.date && cell.date === selected;
            const isToday = !!cell.date && cell.date === today;
            const filled = marked;
            return (
              <TouchableOpacity
                key={cell.key}
                style={styles.dayCell}
                disabled={!cell.day}
                onPress={() => cell.date && setSelected(cell.date)}
                activeOpacity={0.75}
              >
                {cell.day ? (
                  <View
                    style={[
                      styles.dayDisc,
                      filled && { backgroundColor: colors.primary },
                      isSelected && filled && styles.dayDiscSelected,
                      isSelected && !filled && { borderColor: colors.primary, borderWidth: 1.5 },
                      isToday && !filled && !isSelected && { backgroundColor: colors.background },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        { color: filled ? '#fff' : colors.text },
                        isToday && !filled && { color: colors.primary, fontWeight: '800' },
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.dayDisc} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    marginBottom: 16,
  },
  calHead: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    paddingVertical: 6,
  },
  monthTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  weekRow: { flexDirection: 'row', marginBottom: 6, paddingHorizontal: 2 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDiscSelected: {
    transform: [{ scale: 1.06 }],
  },
  dayNum: { fontSize: 14, fontWeight: '600' },
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
