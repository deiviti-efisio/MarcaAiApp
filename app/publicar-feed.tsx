import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrazilStatePickerModal, {
  BrazilStateFieldButton,
} from '../components/BrazilStatePickerModal';
import BrazilPlaceSearchField from '../components/BrazilPlaceSearchField';
import { ChipMultiSelectField } from '../components/ChipMultiSelectField';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTheme } from '../contexts/ThemeContext';
import { ARTIST_WORK_ROLE_PRESETS, buildOrderedOptionsForPicker } from '../constants/artistProfileLists';
import { formatEventLocationSlash } from '../lib/brazilGeo';
import { formatCalendarDate } from '../lib/dateUtils';
import {
  getEventsByMonthWithRole,
  type EventWithRole,
} from '../services/supabase/eventService';
import { publicarFeed, editarAnuncioFeed, listarFeedMarketplace, isNomeAutomaticoFeed, type FeedTipo } from '../services/supabase/feedMarketplaceService';
import { getArtistById } from '../services/supabase/artistService';
import { supabase } from '../lib/supabase';
import { useActiveArtist } from '../services/useActiveArtist';
import {
  extractNumericValueString,
  formatCurrencyBRLFromAmount,
  formatCurrencyBRLInput,
} from '../utils/currencyBRLInput';
import {
  isCompleteBrazilMobile,
  maskBrazilMobile,
} from '../utils/brazilPhone';

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
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAY_MODAL_DISMISS_DRAG = 90;
const DAY_MODAL_DISMISS_VELOCITY = 900;
const DAY_MODAL_DISMISS_DISTANCE = Math.round(Dimensions.get('window').height * 0.45);

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

function todayYmd(): string {
  return toYmd(new Date());
}

function formatTime(t?: string | null) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

function hmToDate(hm: string): Date {
  const d = new Date();
  const parts = String(hm || '').split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  d.setHours(h, m, 0, 0);
  return d;
}

export default function PublicarFeedScreen() {
  const { colors, isDarkMode } = useTheme();
  const { activeArtist } = useActiveArtist();
  const { canCreateEvents } = usePermissions();
  const { tipo: tipoParam, eventId: eventIdParam } = useLocalSearchParams<{
    tipo?: string;
    eventId?: string;
  }>();
  const eventId = typeof eventIdParam === 'string' ? eventIdParam : undefined;
  const isEditMode = !!eventId;
  const [editTipo, setEditTipo] = useState<FeedTipo | null>(null);
  const tipo: FeedTipo =
    editTipo ?? (tipoParam === 'demanda' ? 'demanda' : 'disponivel');

  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [inicio, setInicio] = useState(() => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    return d;
  });
  const [fim, setFim] = useState(() => {
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    return d;
  });
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(true);
  const [events, setEvents] = useState<EventWithRole[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [dayModalEvents, setDayModalEvents] = useState<EventWithRole[] | null>(null);
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);
  const [estadoUf, setEstadoUf] = useState('');
  const [cidade, setCidade] = useState('');
  const [showEstados, setShowEstados] = useState(false);
  const [cacheDraft, setCacheDraft] = useState('');
  const [observacao, setObservacao] = useState('');
  const [nomeEvento, setNomeEvento] = useState('');
  const [selectedFuncoes, setSelectedFuncoes] = useState<string[]>([]);
  const [funcaoDraft, setFuncaoDraft] = useState('');
  const [whatsappDraft, setWhatsappDraft] = useState('');
  const [mostrarCache, setMostrarCache] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const dayOffsetRef = useRef(0);
  const dayModalTranslateY = useSharedValue(0);

  const closeDayModal = useCallback(() => {
    setDayModalEvents(null);
  }, []);

  const finishDayModalDismiss = useCallback(
    (dy: number, vy: number) => {
      const shouldDismiss = dy > DAY_MODAL_DISMISS_DRAG || vy > DAY_MODAL_DISMISS_VELOCITY;

      if (shouldDismiss) {
        dayModalTranslateY.value = withTiming(
          DAY_MODAL_DISMISS_DISTANCE,
          { duration: 220 },
          (finished) => {
            if (finished) {
              runOnJS(closeDayModal)();
            }
          }
        );
        return;
      }

      dayModalTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
    },
    [closeDayModal, dayModalTranslateY]
  );

  const dayModalPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) {
            dayModalTranslateY.value = gesture.dy;
          }
        },
        onPanResponderRelease: (_, gesture) => {
          finishDayModalDismiss(gesture.dy, gesture.vy);
        },
        onPanResponderTerminate: () => {
          dayModalTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
        },
      }),
    [dayModalTranslateY, finishDayModalDismiss]
  );

  const dayModalHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) {
            dayModalTranslateY.value = gesture.dy;
          }
        },
        onPanResponderRelease: (_, gesture) => {
          finishDayModalDismiss(gesture.dy, gesture.vy);
        },
        onPanResponderTerminate: () => {
          dayModalTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
        },
      }),
    [dayModalTranslateY, finishDayModalDismiss]
  );

  const dayModalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dayModalTranslateY.value }],
  }));

  useEffect(() => {
    if (!dayModalEvents) return;
    dayModalTranslateY.value = 0;
  }, [dayModalEvents, dayModalDate, dayModalTranslateY]);

  const scrollAteODia = (delay = 50) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, dayOffsetRef.current - 16),
        animated: true,
      });
    }, delay);
  };

  const viewMonth = viewDate.getMonth();
  const viewYear = viewDate.getFullYear();
  const today = todayYmd();

  const cacheNumber = useMemo(() => {
    const raw = extractNumericValueString(cacheDraft);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }, [cacheDraft]);

  const funcaoPresets = useMemo(() => [...ARTIST_WORK_ROLE_PRESETS], []);

  const funcaoOptions = useMemo(
    () => buildOrderedOptionsForPicker(funcaoPresets, selectedFuncoes),
    [funcaoPresets, selectedFuncoes]
  );

  const toggleFuncao = (label: string) => {
    setSelectedFuncoes((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const addCustomFuncao = () => {
    const trimmed = funcaoDraft.trim();
    if (!trimmed) return;
    if (selectedFuncoes.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert('Atenção', 'Esta função já está selecionada.');
      return;
    }
    if (selectedFuncoes.length >= 8) {
      Alert.alert('Funções', 'Selecione no máximo 8 funções.');
      return;
    }
    setSelectedFuncoes((prev) => [...prev, trimmed]);
    setFuncaoDraft('');
  };

  const eventsForCalendar = useMemo(() => {
    if (!isEditMode || !eventId) return events;
    return events.filter((event) => event.id !== eventId);
  }, [events, eventId, isEditMode]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, EventWithRole[]> = {};
    eventsForCalendar.forEach((event) => {
      if (!event.event_date) return;
      if (!map[event.event_date]) map[event.event_date] = [];
      map[event.event_date].push(event);
    });
    return map;
  }, [eventsForCalendar]);

  const calendarMatrix = useMemo(() => {
    const firstWeekDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const weeks: ({ dayNumber: number; dateString: string } | null)[][] = [];
    let dayCounter = 1 - firstWeekDay;
    while (dayCounter <= totalDays) {
      const week: ({ dayNumber: number; dateString: string } | null)[] = [];
      for (let i = 0; i < 7; i++) {
        const currentDay = dayCounter + i;
        if (currentDay < 1 || currentDay > totalDays) {
          week.push(null);
        } else {
          week.push({
            dayNumber: currentDay,
            dateString: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`,
          });
        }
      }
      weeks.push(week);
      dayCounter += 7;
    }
    return weeks;
  }, [viewMonth, viewYear]);

  useEffect(() => {
    if (!activeArtist?.id) {
      if (!isEditMode) setWhatsappDraft('');
      return;
    }

    let cancelled = false;
    void getArtistById(activeArtist.id).then(({ artist }) => {
      if (cancelled) return;
      if (!isEditMode) {
        setWhatsappDraft(maskBrazilMobile(artist?.whatsapp || ''));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeArtist?.id, isEditMode]);

  useEffect(() => {
    if (!eventId || !activeArtist?.id) {
      setLoadingEdit(false);
      return;
    }

    let cancelled = false;
    setLoadingEdit(true);
    void listarFeedMarketplace({
      filtro: 'meus',
      artistaAtualId: activeArtist.id,
    }).then(async ({ anuncios, error }) => {
      if (cancelled) return;
      if (error) {
        Alert.alert('Erro', error);
        setLoadingEdit(false);
        return;
      }
      const found = anuncios.find((item) => item.id === eventId) ?? null;
      if (!found) {
        Alert.alert('Anúncio', 'Este anúncio não está mais no feed.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        setLoadingEdit(false);
        return;
      }
      if (found.propostas_count > 0) {
        Alert.alert(
          'Não é possível editar',
          'Este anúncio já tem candidatos. Para mudar a data ou outros dados, encerre e publique novamente.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
        setLoadingEdit(false);
        return;
      }

      setEditTipo(found.feed_tipo);
      setSelectedYmd(found.event_date);
      setViewDate(new Date(`${found.event_date}T12:00:00`));
      setInicio(hmToDate(found.start_time));
      setFim(hmToDate(found.end_time));
      setEstadoUf(found.state_uf || '');
      setCidade(found.city || '');
      setObservacao(found.description || '');
      {
        const currentName = String(found.evento_nome ?? '').trim();
        if (currentName) {
          setNomeEvento(currentName);
        } else {
          const { data: eventRow } = await supabase
            .from('events')
            .select('name')
            .eq('id', eventId)
            .maybeSingle();
          if (cancelled) return;
          const fromDb = String(eventRow?.name ?? '').trim();
          setNomeEvento(isNomeAutomaticoFeed(fromDb) ? '' : fromDb);
        }
      }
      setSelectedFuncoes([...found.feed_funcoes]);
      setCacheDraft(formatCurrencyBRLFromAmount(found.cache_valor ?? 0));
      setMostrarCache(found.feed_mostrar_cache);
      setWhatsappDraft(maskBrazilMobile(found.artist_whatsapp || ''));
      setLoadingEdit(false);
    });

    return () => {
      cancelled = true;
    };
  }, [eventId, activeArtist?.id]);

  useEffect(() => {
    if (!activeArtist?.id) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoadingEvents(true);
    void getEventsByMonthWithRole(activeArtist.id, viewYear, viewMonth).then((result) => {
      if (cancelled) return;
      setEvents(result.success ? result.events || [] : []);
      setLoadingEvents(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeArtist?.id, viewMonth, viewYear]);

  const selecionarDia = (dateString: string, delay = 50) => {
    if (dateString < today) {
      Alert.alert('Data', 'Escolha um dia de hoje em diante.');
      return false;
    }
    setSelectedYmd(dateString);
    scrollAteODia(delay);
    return true;
  };

  const handleDayPress = (dateString: string) => {
    if (dateString < today) return;
    selecionarDia(dateString);
  };

  const submit = async () => {
    if (!activeArtist?.id) {
      Alert.alert('Artista', 'Selecione um artista nas Configurações.');
      return;
    }
    if (!canCreateEvents) {
      Alert.alert('Sem permissão', 'Somente admin ou vendedor pode publicar no feed.');
      return;
    }
    if (!nomeEvento.trim()) {
      Alert.alert('Nome', 'Informe o nome da oportunidade.');
      return;
    }
    if (cacheNumber <= 0) {
      Alert.alert(
        'Cachê',
        'Informe o valor do cachê. Ao aceitar a negociação, esse valor entra como despesa na agenda.'
      );
      return;
    }
    if (!selectedYmd) {
      Alert.alert('Dia', 'Escolha um dia no calendário.');
      return;
    }
    if (selectedYmd < today) {
      Alert.alert('Data', 'Só é possível criar oportunidade em datas de hoje em diante.');
      return;
    }
    if (!toHm(inicio) || !toHm(fim)) {
      Alert.alert('Horário', 'Informe o horário inicial e o final.');
      return;
    }
    if (toHm(fim) <= toHm(inicio)) {
      Alert.alert('Horário', 'O horário final precisa ser depois do início.');
      return;
    }
    if (selectedFuncoes.length === 0) {
      Alert.alert(
        'Funções',
        'Selecione pelo menos uma função (ex.: Vocalista, Guitarrista).'
      );
      return;
    }
    if (!cidade.trim()) {
      Alert.alert('Cidade', 'Informe a cidade.');
      return;
    }
    if (!estadoUf.trim()) {
      Alert.alert('Estado', 'Selecione o estado.');
      return;
    }
    if (!isCompleteBrazilMobile(whatsappDraft)) {
      Alert.alert(
        'WhatsApp',
        'Informe um WhatsApp válido para contato (DDD + número). Usamos o número salvo no perfil do artista, se já existir.'
      );
      return;
    }
    setSaving(true);
    const payload = {
      eventDate: selectedYmd,
      stateUf: estadoUf,
      cacheValor: cacheNumber,
      city: cidade,
      startTime: toHm(inicio),
      endTime: toHm(fim),
      observacao,
      feedFuncoes: selectedFuncoes,
      whatsapp: whatsappDraft.trim(),
      mostrarCache,
      nome: nomeEvento.trim(),
    };

    const result = isEditMode && eventId
      ? await editarAnuncioFeed({ eventoId: eventId, ...payload })
      : await publicarFeed({
          artistaId: activeArtist.id,
          feedTipo: tipo,
          ...payload,
        });
    setSaving(false);
    if (!result.success) {
      Alert.alert('Erro', result.error || (isEditMode ? 'Não foi possível salvar.' : 'Não foi possível publicar.'));
      return;
    }
    router.back();
  };

  if (loadingEdit) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.loadingEdit}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {isEditMode ? 'Editar oportunidade' : 'Nova oportunidade'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.label, { color: colors.text }]}>Nome da oportunidade *</Text>
          <TextInput
            value={nomeEvento}
            onChangeText={setNomeEvento}
            placeholder="Ex.: Show no Bar do Zé"
            placeholderTextColor={colors.textSecondary}
            maxLength={80}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />

          <Text style={[styles.label, { color: colors.text }]}>Cachê *</Text>
          <TextInput
            value={cacheDraft}
            onChangeText={(t) => {
              const masked = formatCurrencyBRLInput(t);
              setCacheDraft(masked);
              if (!extractNumericValueString(masked)) {
                setMostrarCache(false);
              }
            }}
            keyboardType="number-pad"
            placeholder="R$ 0,00"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />
          <Text style={[styles.rolesHint, { color: colors.textSecondary }]}>
            Obrigatório. Ao fechar a negociação, esse valor entra como despesa na agenda.
          </Text>
          <View style={[styles.switchRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.switchCopy}>
              <Text style={[styles.switchTitle, { color: colors.text }]}>Mostrar cachê no feed</Text>
              <Text style={[styles.rolesHint, { color: colors.textSecondary, marginTop: 2 }]}>
                {mostrarCache
                  ? 'Todos verão o valor no card.'
                  : 'O valor só aparece quando alguém demonstrar interesse.'}
              </Text>
            </View>
            <Switch
              value={mostrarCache}
              onValueChange={setMostrarCache}
              disabled={cacheNumber <= 0}
              trackColor={{ false: colors.border, true: `${colors.primary}66` }}
              thumbColor={Platform.OS === 'android' ? (mostrarCache ? colors.primary : '#f4f3f4') : undefined}
            />
          </View>
          {!mostrarCache ? (
            <View style={[styles.lockHint, { backgroundColor: `${colors.primary}12` }]}>
              <Ionicons name="lock-closed" size={16} color={colors.primary} />
              <Text style={[styles.lockHintText, { color: colors.textSecondary }]}>
                Com a opção desligada, o cachê fica oculto no feed e só é revelado na negociação.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.calendarToggle,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => setCalendarVisible((prev) => !prev)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={calendarVisible ? 'chevron-up' : 'calendar-outline'}
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.calendarToggleText, { color: colors.text }]}>
              {calendarVisible ? 'Ocultar calendário' : 'Mostrar calendário'}
            </Text>
          </TouchableOpacity>

          {calendarVisible ? (
            <View
              style={[
                styles.calendarBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.monthNav}>
                <TouchableOpacity
                  style={[styles.navBtn, { backgroundColor: colors.secondary }]}
                  onPress={() =>
                    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                  }
                >
                  <Ionicons name="chevron-back" size={20} color={colors.primary} />
                </TouchableOpacity>
                <View style={styles.monthTitle}>
                  <Text style={[styles.monthText, { color: colors.text }]}>
                    {MONTHS[viewMonth]} / {viewYear}
                  </Text>
                  {loadingEvents ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[styles.navBtn, { backgroundColor: colors.secondary }]}
                  onPress={() =>
                    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                  }
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={styles.weekHeader}>
                {WEEKDAYS.map((label) => (
                  <Text key={label} style={[styles.weekHeaderText, { color: colors.textSecondary }]}>
                    {label}
                  </Text>
                ))}
              </View>

              {calendarMatrix.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={styles.weekRow}>
                  {week.map((day, dayIndex) => {
                    if (!day) {
                      return <View key={`empty-${weekIndex}-${dayIndex}`} style={styles.dayCell} />;
                    }
                    const dayEvents = eventsByDate[day.dateString] || [];
                    const temEvento = dayEvents.length > 0;
                    const isToday = day.dateString === today;
                    const isSelected = day.dateString === selectedYmd;
                    const isPast = day.dateString < today;
                    return (
                      <TouchableOpacity
                        key={day.dateString}
                        disabled={isPast}
                        style={[
                          styles.dayCell,
                          isPast && { opacity: 0.38 },
                          temEvento && !isSelected && !isPast && { backgroundColor: colors.secondary },
                          isToday && !isSelected && { borderColor: colors.primary, borderWidth: 1.5 },
                          isSelected && {
                            backgroundColor: colors.primary,
                            borderColor: colors.primary,
                            borderWidth: 1.5,
                          },
                        ]}
                        onPress={() => handleDayPress(day.dateString)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            {
                              color: isSelected
                                ? '#fff'
                                : isPast
                                  ? colors.border
                                  : temEvento || isToday
                                    ? colors.text
                                    : colors.textSecondary,
                            },
                          ]}
                        >
                          {day.dayNumber}
                        </Text>
                        {temEvento && !isPast ? (
                          <View
                            style={[
                              styles.eventDot,
                              {
                                backgroundColor: isSelected ? '#fff' : colors.primary,
                              },
                            ]}
                          />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              <View style={styles.legend}>
                <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                  Só datas de hoje em diante. Datas passadas não podem ser escolhidas, mesmo com evento na agenda.
                </Text>
              </View>
            </View>
          ) : null}

          <View
            onLayout={(e) => {
              dayOffsetRef.current = e.nativeEvent.layout.y;
            }}
          >
          <Text style={[styles.label, { color: colors.text }]}>
            Dia do show (obrigatório)
          </Text>
          <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="calendar" size={18} color={colors.primary} />
            <Text
              style={[
                styles.fieldText,
                { color: selectedYmd ? colors.text : colors.textSecondary },
              ]}
            >
              {selectedYmd ? formatCalendarDate(selectedYmd) : 'Toque em um dia no calendário'}
            </Text>
          </View>
          </View>

          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.text }]}>Início (obrigatório)</Text>
              <TouchableOpacity
                style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setPicker('start')}
              >
                <Text style={[styles.fieldText, { color: colors.text }]}>{toHm(inicio)}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.text }]}>Fim (obrigatório)</Text>
              <TouchableOpacity
                style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setPicker('end')}
              >
                <Text style={[styles.fieldText, { color: colors.text }]}>{toHm(fim)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {picker ? (
            <View>
              <DateTimePicker
                value={picker === 'start' ? inicio : fim}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(ev, date) => {
                  if (Platform.OS === 'android') setPicker(null);
                  if (ev.type === 'dismissed' || !date) {
                    if (Platform.OS === 'ios' && ev.type === 'dismissed') setPicker(null);
                    return;
                  }
                  if (picker === 'start') setInicio(date);
                  if (picker === 'end') setFim(date);
                }}
                themeVariant={isDarkMode ? 'dark' : 'light'}
              />
              {Platform.OS === 'ios' ? (
                <TouchableOpacity
                  style={[styles.okPicker, { backgroundColor: colors.primary }]}
                  onPress={() => setPicker(null)}
                >
                  <Text style={styles.okPickerText}>OK</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <ChipMultiSelectField
            title="Funções *"
            options={funcaoOptions}
            selected={selectedFuncoes}
            onToggle={toggleFuncao}
            draft={funcaoDraft}
            onDraftChange={setFuncaoDraft}
            onAddCustom={addCustomFuncao}
            addSectionLabel="Ou digite uma função"
            addPlaceholder="Ex.: Vocalista"
            presetStrip={funcaoPresets}
            horizontalOnly
          />

          <Text style={[styles.label, { color: colors.text }]}>WhatsApp para contato *</Text>
          <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
            <TextInput
              value={whatsappDraft}
              onChangeText={(text) => setWhatsappDraft(maskBrazilMobile(text))}
              placeholder="(XX) XXXXX-XXXX"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
              style={[styles.whatsappInput, { color: colors.text }]}
              maxLength={15}
            />
          </View>
          <Text style={[styles.rolesHint, { color: colors.textSecondary }]}>
            Quem ver seu anúncio poderá entrar em contato por este número. Se o artista já tem WhatsApp salvo, ele aparece aqui.
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>Cidade *</Text>
          <BrazilPlaceSearchField
            value={cidade}
            onChangeText={setCidade}
            onSelectPlace={(place) => {
              setCidade(place.city);
              if (place.uf) setEstadoUf(place.uf);
            }}
            placeholder="Digite a cidade"
            citiesOnly
          />

          <Text style={[styles.label, { color: colors.text }]}>Estado *</Text>
          <BrazilStateFieldButton
            selectedUf={estadoUf}
            onPress={() => setShowEstados(true)}
            colors={colors}
          />

          <Text style={[styles.label, { color: colors.text }]}>Observações (opcional)</Text>
          <TextInput
            value={observacao}
            onChangeText={setObservacao}
            placeholder="Formato do show, região da cidade, etc."
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.input,
              styles.multiline,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />

          <TouchableOpacity
            style={[styles.submit, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
            onPress={() => void submit()}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {isEditMode ? 'Salvar alterações' : 'Publicar anúncio'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <BrazilStatePickerModal
        visible={showEstados}
        onClose={() => setShowEstados(false)}
        selectedUf={estadoUf}
        onSelect={(uf) => setEstadoUf(uf || '')}
      />

      <Modal
        visible={!!dayModalEvents}
        transparent
        animationType="fade"
        onRequestClose={closeDayModal}
      >
        <GestureHandlerRootView style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={styles.modalOverlay} onPress={closeDayModal} />

          <Animated.View
            pointerEvents="auto"
            style={[
              styles.modalCard,
              dayModalAnimatedStyle,
              { backgroundColor: colors.surface, zIndex: 2 },
            ]}
          >
            <View {...dayModalHandlePanResponder.panHandlers} style={styles.modalHandleTouch}>
              <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            </View>

            <View {...dayModalPanResponder.panHandlers}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: `${colors.primary}18` }]}>
                <Ionicons name="calendar" size={22} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderCopy}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {dayModalDate ? formatCalendarDate(dayModalDate) : 'Data fechada'}
                </Text>
                <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                  {dayModalEvents?.length === 1
                    ? '1 show neste dia'
                    : `${dayModalEvents?.length ?? 0} shows neste dia`}
                </Text>
              </View>
            </View>

            <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
              Você pode publicar outro anúncio na mesma data.
            </Text>

            <View style={styles.modalEventsList}>
              {(dayModalEvents || []).map((event) => {
                const location = formatEventLocationSlash({
                  city: event.city,
                  state_uf: event.state_uf,
                });
                return (
                  <View
                    key={event.id}
                    style={[styles.modalEvent, { borderColor: colors.border, backgroundColor: colors.background }]}
                  >
                    <View style={[styles.modalEventIcon, { backgroundColor: `${colors.error}18` }]}>
                      <Ionicons name="lock-closed" size={14} color={colors.error} />
                    </View>
                    <View style={styles.modalEventBody}>
                      <Text style={[styles.eventName, { color: colors.text }]} numberOfLines={2}>
                        {event.name}
                      </Text>
                      {event.value != null && Number(event.value) > 0 ? (
                        <Text style={[styles.eventValue, { color: colors.primary }]} numberOfLines={1}>
                          {formatCurrencyBRLFromAmount(Number(event.value))}
                        </Text>
                      ) : null}
                      <Text style={[styles.eventMeta, { color: colors.textSecondary }]}>
                        {formatTime(event.start_time)
                          ? `${formatTime(event.start_time)}–${formatTime(event.end_time)}`
                          : 'Horário não definido'}
                      </Text>
                      {location ? (
                        <View style={styles.modalEventLocationRow}>
                          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                          <Text style={[styles.modalEventLocation, { color: colors.textSecondary }]}>
                            {location}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtnOutline, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={closeDayModal}
                activeOpacity={0.85}
              >
                <Text style={[styles.modalBtnOutlineText, { color: colors.text }]}>Fechar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtnPrimary, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (!dayModalDate) return;
                  if (selecionarDia(dayModalDate, 280)) {
                    closeDayModal();
                    setDayModalDate(null);
                  }
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.modalBtnPrimaryText}>Adicionar show</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loadingEdit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  body: { padding: 16, paddingBottom: 40, gap: 8 },
  label: { fontSize: 14, fontWeight: '700', marginTop: 10 },
  rolesHint: { fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 4 },
  calendarToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  calendarToggleText: { fontSize: 15, fontWeight: '600' },
  calendarBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: { alignItems: 'center', gap: 6 },
  monthText: { fontSize: 16, fontWeight: '800' },
  weekHeader: { flexDirection: 'row', marginBottom: 6 },
  weekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayText: { fontSize: 15, fontWeight: '700' },
  eventDot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  legend: {
    marginTop: 8,
    gap: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12 },
  eventName: { fontSize: 14, fontWeight: '700' },
  eventValue: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  eventMeta: { fontSize: 12, marginTop: 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldText: { fontSize: 16, fontWeight: '600', flex: 1 },
  whatsappInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 0,
    minWidth: 0,
  },
  timeRow: { flexDirection: 'row', gap: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  lockHint: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    padding: 10,
    alignItems: 'flex-start',
  },
  lockHintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switchCopy: { flex: 1 },
  switchTitle: { fontSize: 14, fontWeight: '700' },
  okPicker: {
    alignSelf: 'flex-end',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  okPickerText: { color: '#fff', fontWeight: '800' },
  submit: {
    marginTop: 18,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 0,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 10,
    maxHeight: '82%',
  },
  modalHandleTouch: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 12,
  },
  modalHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalSub: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  modalEventsList: {
    gap: 8,
    marginBottom: 16,
  },
  modalEvent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  modalEventIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  modalEventBody: { flex: 1, minWidth: 0, gap: 3 },
  modalEventLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  modalEventLocation: { fontSize: 12, fontWeight: '600', flex: 1 },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtnOutline: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalBtnOutlineText: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalBtnPrimary: {
    flex: 1.35,
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  modalBtnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
