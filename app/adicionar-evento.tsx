import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { persistViewedMonth } from '../contexts/SharedTabMonthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { getArtists } from '../services/supabase/artistService';
import { getCurrentUser } from '../services/supabase/authService';
import { uploadEventContractFile } from '../services/supabase/eventContractUploadService';
import { createEvent, CreateExpenseData, getRecentEventNameSuggestions, type RecentEventSuggestion } from '../services/supabase/eventService';
import { useActiveArtist } from '../services/useActiveArtist';
import {
  extractNumericValueString,
  formatCurrencyBRLFromAmount,
  formatCurrencyBRLInput,
} from '../utils/currencyBRLInput';
import { maybeShowConnectionError } from '../utils/maybeShowConnectionError';
import BrazilStatePickerModal, { BrazilStateFieldButton } from '../components/BrazilStatePickerModal';
import EventPaymentProgress, { parseOptionalPaidAmount } from '../components/EventPaymentProgress';

interface EventoForm {
  nome: string;
  valor: string;
  valorPago: string;
  cidade: string;
  estadoUf: string;
  telefoneContratante: string;
  data: Date;
  horarioInicio: Date;
  horarioFim: Date;
  status: 'confirmado' | 'a_confirmar';
  descricao: string;
  descricaoViewer: string;
  tag: 'ensaio' | 'evento' | 'reunião';
}

interface DespesaForm {
  nome: string;
  valor: string;
}

/** Máscara (XX) XXXXX-XXXX para celular brasileiro (11 dígitos). */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const PREVIOUS_EVENTS_SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.94);
const PREVIOUS_EVENTS_DISMISS_DRAG = 90;
const PREVIOUS_EVENTS_DISMISS_VELOCITY = 900;

// Componente para seleção de data
const DatePickerComponent = ({
  selectedDate,
  onDateChange,
  visible = true,
  colors,
}: {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  visible?: boolean;
  colors: any;
}) => {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());

  React.useEffect(() => {
    if (!visible) return;
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [visible, selectedDate]);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const daysInSelectedMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayWeekday = new Date(viewYear, viewMonth, 1).getDay();

  const calendarDays: { day: number | null; date: Date | null }[] = [];

  for (let i = 0; i < firstDayWeekday; i++) {
    calendarDays.push({ day: null, date: null });
  }

  for (let day = 1; day <= daysInSelectedMonth; day++) {
    calendarDays.push({
      day,
      date: new Date(viewYear, viewMonth, day),
    });
  }

  const isSelectedDay = (day: number) =>
    day === selectedDate.getDate() &&
    viewMonth === selectedDate.getMonth() &&
    viewYear === selectedDate.getFullYear();

  const goToMonth = (offset: number) => {
    const next = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];

  return (
    <View style={styles.datePickerContainer}>
      <View style={styles.monthNav}>
        <TouchableOpacity
          style={[styles.monthNavBtn, { backgroundColor: colors.secondary }]}
          onPress={() => goToMonth(-1)}
          accessibilityLabel="Mês anterior"
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.monthYearLabel, { color: colors.text }]}>
          {monthNames[viewMonth]} / {viewYear}
        </Text>
        <TouchableOpacity
          style={[styles.monthNavBtn, { backgroundColor: colors.secondary }]}
          onPress={() => goToMonth(1)}
          accessibilityLabel="Próximo mês"
        >
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayHeader}>
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((weekday) => (
          <Text key={weekday} style={[styles.weekdayHeaderText, { color: colors.textSecondary }]}>
            {weekday}
          </Text>
        ))}
      </View>

      <View style={styles.daysGrid}>
        {calendarDays.map((dayInfo, index) => {
          const selected = !!dayInfo.day && isSelectedDay(dayInfo.day);
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.dayItem,
                { backgroundColor: colors.background },
                selected ? [styles.dayItemSelected, { backgroundColor: colors.primary }] : null,
                !dayInfo.day ? styles.dayItemEmpty : null,
              ]}
              onPress={() => {
                if (dayInfo.date) onDateChange(dayInfo.date);
              }}
              disabled={!dayInfo.day}
            >
              {dayInfo.day ? (
                <Text
                  style={[
                    styles.dayNumberText,
                    { color: colors.text },
                    selected && styles.dayNumberTextSelected,
                  ]}
                >
                  {dayInfo.day}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// Componente para seleção de horário
const TimePickerComponent = ({ selectedTime, onTimeChange, colors }: { selectedTime: Date; onTimeChange: (time: Date) => void; colors: any }) => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const [selectedHour, setSelectedHour] = useState(selectedTime.getHours());
  const [selectedMinute, setSelectedMinute] = useState(selectedTime.getMinutes());

  // Sincronizar com o selectedTime quando ele mudar
  React.useEffect(() => {
    setSelectedHour(selectedTime.getHours());
    setSelectedMinute(selectedTime.getMinutes());
  }, [selectedTime]);

  const updateTime = (hour: number, minute: number) => {
    const newTime = new Date();
    newTime.setHours(hour, minute, 0, 0);
    onTimeChange(newTime);
  };

  return (
    <View style={styles.pickerContainer}>
      <View style={styles.pickerColumn}>
        <Text style={[styles.pickerLabel, { color: colors.text }]}>Hora</Text>
        <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
          {hours.map((hour) => (
            <TouchableOpacity
              key={hour}
              style={[
                styles.pickerItem,
                { backgroundColor: colors.background },
                selectedHour === hour && [styles.pickerItemSelected, { backgroundColor: colors.primary }]
              ]}
              onPress={() => {
                setSelectedHour(hour);
                updateTime(hour, selectedMinute);
              }}
            >
              <Text style={[
                styles.pickerItemText,
                { color: colors.text },
                selectedHour === hour && styles.pickerItemTextSelected
              ]}>
                {hour.toString().padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.pickerColumn}>
        <Text style={[styles.pickerLabel, { color: colors.text }]}>Minuto</Text>
        <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
          {minutes.map((minute) => (
            <TouchableOpacity
              key={minute}
              style={[
                styles.pickerItem,
                { backgroundColor: colors.background },
                selectedMinute === minute && [styles.pickerItemSelected, { backgroundColor: colors.primary }]
              ]}
              onPress={() => {
                setSelectedMinute(minute);
                updateTime(selectedHour, minute);
              }}
            >
              <Text style={[
                styles.pickerItemText,
                { color: colors.text },
                selectedMinute === minute && styles.pickerItemTextSelected
              ]}>
                {minute.toString().padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

export default function AdicionarEventoScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  
  // Sempre usar dados atualizados - data atual como padrão
  const currentDate = new Date();
  const selectedMonth = params.selectedMonth ? parseInt(params.selectedMonth as string) : currentDate.getMonth();
  const selectedYear = params.selectedYear ? parseInt(params.selectedYear as string) : currentDate.getFullYear();
  const initialDate = params.selectedDate ? new Date(params.selectedDate as string) : new Date(selectedYear, selectedMonth, currentDate.getDate());

  // Criar horários padrão
  const createDefaultTime = (hour: number, minute: number = 0) => {
    const time = new Date();
    time.setHours(hour, minute, 0, 0);
    return time;
  };

  const [form, setForm] = useState<EventoForm>({
    nome: '',
    valor: '',
    valorPago: '',
    cidade: '',
    estadoUf: '',
    telefoneContratante: '',
    data: initialDate,
    // 00:00/00:00 significa "horário não definido"
    horarioInicio: createDefaultTime(0, 0),
    horarioFim: createDefaultTime(0, 0),
    status: 'confirmado',
    descricao: '',
    descricaoViewer: '',
    tag: 'evento', // Valor padrão
  });

  const [despesas, setDespesas] = useState<DespesaForm[]>([]);

  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeInicioModal, setShowTimeInicioModal] = useState(false);
  const [showTimeFimModal, setShowTimeFimModal] = useState(false);
  const [showEstadoModal, setShowEstadoModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [contractUri, setContractUri] = useState<string | null>(null);
  const [contractName, setContractName] = useState<string | null>(null);
  const [contractMime, setContractMime] = useState<string | null>(null);
  const { activeArtist: contextArtist } = useActiveArtistContext();
  const { activeArtist: storedArtist } = useActiveArtist();
  const artistId = contextArtist?.id || storedArtist?.id;
  const [recentSuggestions, setRecentSuggestions] = useState<RecentEventSuggestion[]>([]);
  const [showPreviousEventsModal, setShowPreviousEventsModal] = useState(false);
  const [loadingPreviousEvents, setLoadingPreviousEvents] = useState(false);
  const previousSheetTranslateY = useSharedValue(0);
  const previousListScrollY = useSharedValue(0);

  const closePreviousEventsModal = useCallback(() => {
    previousSheetTranslateY.value = 0;
    previousListScrollY.value = 0;
    setShowPreviousEventsModal(false);
  }, [previousListScrollY, previousSheetTranslateY]);

  const finishPreviousEventsDismiss = useCallback(
    (dy: number, vy: number) => {
      if (dy > PREVIOUS_EVENTS_DISMISS_DRAG || vy > PREVIOUS_EVENTS_DISMISS_VELOCITY) {
        previousSheetTranslateY.value = withTiming(
          PREVIOUS_EVENTS_SHEET_HEIGHT,
          { duration: 220 },
          (finished) => {
            if (finished) runOnJS(closePreviousEventsModal)();
          },
        );
        return;
      }
      previousSheetTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
    },
    [closePreviousEventsModal, previousSheetTranslateY],
  );

  useEffect(() => {
    if (showPreviousEventsModal) {
      previousSheetTranslateY.value = 0;
      previousListScrollY.value = 0;
    }
  }, [previousListScrollY, previousSheetTranslateY, showPreviousEventsModal]);

  const previousHandlePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) previousSheetTranslateY.value = gesture.dy;
        },
        onPanResponderRelease: (_, gesture) => {
          finishPreviousEventsDismiss(gesture.dy, gesture.vy);
        },
        onPanResponderTerminate: () => {
          previousSheetTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
        },
      }),
    [finishPreviousEventsDismiss, previousSheetTranslateY],
  );

  const previousListScrollGesture = Gesture.Native();
  const previousDismissPanGesture = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .simultaneousWithExternalGesture(previousListScrollGesture)
    .onUpdate((event) => {
      if (previousListScrollY.value <= 1 && event.translationY > 0) {
        previousSheetTranslateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (previousListScrollY.value <= 1) {
        runOnJS(finishPreviousEventsDismiss)(event.translationY, event.velocityY);
        return;
      }
      previousSheetTranslateY.value = withSpring(0, { damping: 22, stiffness: 220 });
    });

  const previousSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: previousSheetTranslateY.value }],
  }));

  const pickContract = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setContractUri(asset.uri);
      setContractName(asset.name ?? 'documento');
      setContractMime(asset.mimeType ?? null);
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar o arquivo.');
    }
  };

  const clearContract = () => {
    setContractUri(null);
    setContractName(null);
    setContractMime(null);
  };

  const handleSave = async () => {
    // Validações básicas - apenas Nome, Valor e Data são obrigatórios
    if (!form.nome.trim()) {
      Alert.alert('Erro', 'Nome do evento é obrigatório');
      return;
    }
    if (!form.valor.trim()) {
      Alert.alert('Erro', 'Valor é obrigatório');
      return;
    }

    // Extrair valor numérico do texto formatado
    const numericValue = extractNumericValueString(form.valor);
    if (!numericValue || isNaN(parseFloat(numericValue))) {
      Alert.alert('Erro', 'Valor deve ser um número válido');
      return;
    }

    const paidAmount = parseOptionalPaidAmount(form.valorPago);
    if (paidAmount != null && paidAmount > parseFloat(numericValue)) {
      Alert.alert('Valor pago antecipado', 'O valor pago antecipado não pode ser maior que o valor do evento.');
      return;
    }

    setIsLoading(true);

    try {
      // Obter o usuário atual e seu artista
      const { user, error: userError } = await getCurrentUser();

      if (!user) {
        if (maybeShowConnectionError(null, userError)) {
          return;
        }
        Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
        return;
      }

      const { artists, error: artistsError } = await getArtists(user.id);

      if (maybeShowConnectionError(null, artistsError)) {
        return;
      }
      if (artistsError) {
        Alert.alert('Erro', artistsError);
        return;
      }
      if (!artists || artists.length === 0) {
        Alert.alert('Erro', 'Nenhum artista encontrado. Crie um perfil de artista primeiro.');
        return;
      }

      const saveArtistId = artistId || artists[0].id;

      let contractUrl: string | undefined;
      let contractFileName: string | undefined;
      if (contractUri) {
        const upload = await uploadEventContractFile(contractUri, {
          mimeType: contractMime,
          fileName: contractName,
        });
        if (!upload.success || !upload.url) {
          const uerr = upload.error ?? '';
          if (maybeShowConnectionError(null, uerr)) {
            /* modal global */
          } else {
            Alert.alert('Erro', uerr || 'Não foi possível enviar o contrato.');
          }
          return;
        }
        contractUrl = upload.url;
        contractFileName = contractName ?? undefined;
      }

      // Preparar despesas
      const expensesData: CreateExpenseData[] = despesas
        .filter(despesa => despesa.nome.trim() && despesa.valor.trim())
        .map(despesa => ({
          name: despesa.nome.trim(),
          value: parseFloat(despesa.valor) / 100, // Converter centavos para reais
        }));

      const eventData = {
        artist_id: saveArtistId,
        user_id: user.id,
        name: form.nome.trim(),
        description: form.descricao.trim() || undefined,
        viewer_description: form.descricaoViewer.trim() || undefined,
        event_date: `${form.data.getFullYear()}-${String(form.data.getMonth() + 1).padStart(2, '0')}-${String(form.data.getDate()).padStart(2, '0')}`, // YYYY-MM-DD
        start_time: form.horarioInicio.toTimeString().split(' ')[0].substring(0, 5), // HH:MM
        end_time: form.horarioFim.toTimeString().split(' ')[0].substring(0, 5), // HH:MM
        value: numericValue !== '' ? parseFloat(numericValue) : undefined,
        paid_amount: paidAmount,
        city: form.cidade.trim() || undefined,
        state_uf: form.estadoUf.trim()
          ? form.estadoUf.trim().toUpperCase().slice(0, 2)
          : null,
        contractor_phone: form.telefoneContratante.trim() || undefined,
        confirmed: form.status === 'confirmado',
        tag: form.tag,
        contract_url: contractUrl ?? null,
        contract_file_name: contractFileName ?? null,
        expenses: expensesData
      };

      const result = await createEvent(eventData);

      if (result.success) {
        persistViewedMonth(form.data);
        router.replace({
          pathname: '/(tabs)/agenda',
          params: { eventCreatedToast: '1' },
        });
      } else {
        const errMsg = result.error ?? '';
        if (!maybeShowConnectionError(null, errMsg)) {
          Alert.alert('Erro', errMsg || 'Erro ao salvar evento');
        }
      }
    } catch (e) {
      if (!maybeShowConnectionError(e)) {
        Alert.alert('Erro', 'Erro ao salvar evento');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR');
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const updateForm = (field: keyof EventoForm, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const applyRecentSuggestion = (suggestion: RecentEventSuggestion) => {
    const valorFromEvent =
      suggestion.value != null ? formatCurrencyBRLFromAmount(suggestion.value) : '';
    setForm((prev) => ({
      ...prev,
      nome: suggestion.name,
      valor: valorFromEvent || prev.valor,
    }));
    closePreviousEventsModal();
  };

  const openPreviousEventsModal = async () => {
    setShowPreviousEventsModal(true);
    setLoadingPreviousEvents(true);
    try {
      let id = artistId;
      if (!id) {
        const { user } = await getCurrentUser();
        if (!user) return;
        const { artists } = await getArtists(user.id);
        id = artists?.[0]?.id;
      }
      if (!id) {
        setRecentSuggestions([]);
        return;
      }
      const { suggestions } = await getRecentEventNameSuggestions(id, 20);
      setRecentSuggestions(suggestions);
    } finally {
      setLoadingPreviousEvents(false);
    }
  };

  const addDespesa = () => {
    setDespesas(prev => [...prev, { nome: '', valor: '' }]);
  };

  const removeDespesa = (index: number) => {
    setDespesas(prev => prev.filter((_, i) => i !== index));
  };

  const updateDespesa = (index: number, field: keyof DespesaForm, value: any) => {
    setDespesas(prev => prev.map((despesa, i) => 
      i === index ? { ...despesa, [field]: value } : despesa
    ));
  };


  const openDatePicker = () => {
    setShowDateModal(true);
  };

  const openTimeInicioPicker = () => {
    setShowTimeInicioModal(true);
  };

  const openTimeFimPicker = () => {
    setShowTimeFimModal(true);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isLoading}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          Adicionar Evento
        </Text>
        <TouchableOpacity
          style={[
            styles.headerSaveButton,
            { backgroundColor: colors.primary },
            isLoading && styles.saveButtonDisabled,
          ]}
          onPress={() => void handleSave()}
          disabled={isLoading}
          accessibilityLabel="Salvar evento"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.headerSaveButtonText}>Salvar</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 100 }}
        >
        {/* Nome do Evento */}
        <View style={styles.inputGroup}>
          <View style={styles.nameLabelRow}>
            <Text style={[styles.label, styles.nameLabel, { color: colors.text }]}>
              Nome do Evento *
            </Text>
            <TouchableOpacity
              onPress={() => void openPreviousEventsModal()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text style={[styles.previousEventsLink, { color: colors.textSecondary }]}>
                Reutilizar
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.nome}
            onChangeText={(text) => updateForm('nome', text)}
            placeholder="Ex: Rock in Rio 2025"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        {/* Valor */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Valor do evento *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.valor}
            onChangeText={(text) => {
              const formatted = formatCurrencyBRLInput(text);
              updateForm('valor', formatted);
            }}
            placeholder="R$ 0,00"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            blurOnSubmit={true}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Valor pago antecipado (Opcional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.valorPago}
            onChangeText={(text) => updateForm('valorPago', formatCurrencyBRLInput(text))}
            placeholder="Informe o valor já recebido"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            blurOnSubmit={true}
          />
          <EventPaymentProgress
            eventValue={extractNumericValueString(form.valor)}
            paidAmount={parseOptionalPaidAmount(form.valorPago)}
            barColor={colors.success}
            trackColor={colors.border}
            textColor={colors.textSecondary}
          />
        </View>

        {/* Data */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Data do Evento *</Text>
          <TouchableOpacity
            style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={openDatePicker}
          >
            <Ionicons name="calendar" size={20} color={colors.primary} />
            <Text style={[styles.dateButtonText, { color: colors.text }]}>{formatDate(form.data)}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.primary} style={styles.chevronIcon} />
          </TouchableOpacity>
        </View>

        {/* Horário de Início */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Horário de Início</Text>
          <TouchableOpacity
            style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={openTimeInicioPicker}
          >
            <Ionicons name="time" size={20} color={colors.primary} />
            <Text style={[styles.dateButtonText, { color: colors.text }]}>{formatTime(form.horarioInicio)}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.primary} style={styles.chevronIcon} />
          </TouchableOpacity>
        </View>

        {/* Horário de Fim */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Horário de Fim</Text>
          <TouchableOpacity
            style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={openTimeFimPicker}
          >
            <Ionicons name="time" size={20} color={colors.primary} />
            <Text style={[styles.dateButtonText, { color: colors.text }]}>{formatTime(form.horarioFim)}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.primary} style={styles.chevronIcon} />
          </TouchableOpacity>
        </View>

        {/* Tipo de Evento (Tag) */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Tipo de Evento</Text>
          <View style={styles.tagContainer}>
            <TouchableOpacity
              style={[
                styles.tagButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                form.tag === 'ensaio' && { backgroundColor: '#10B981', borderColor: '#10B981' }
              ]}
              onPress={() => updateForm('tag', 'ensaio')}
            >
              <Ionicons 
                name="musical-notes" 
                size={20} 
                color={form.tag === 'ensaio' ? '#fff' : '#10B981'} 
              />
              <Text style={[
                styles.tagButtonText,
                { color: form.tag === 'ensaio' ? '#fff' : colors.text }
              ]}>
                Ensaio
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tagButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                form.tag === 'evento' && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]}
              onPress={() => updateForm('tag', 'evento')}
            >
              <Ionicons 
                name="mic" 
                size={20} 
                color={form.tag === 'evento' ? '#fff' : colors.primary} 
              />
              <Text style={[
                styles.tagButtonText,
                { color: form.tag === 'evento' ? '#fff' : colors.text }
              ]}>
                Evento
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tagButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                form.tag === 'reunião' && { backgroundColor: '#F59E0B', borderColor: '#F59E0B' }
              ]}
              onPress={() => updateForm('tag', 'reunião')}
            >
              <Ionicons 
                name="people" 
                size={20} 
                color={form.tag === 'reunião' ? '#fff' : '#F59E0B'} 
              />
              <Text style={[
                styles.tagButtonText,
                { color: form.tag === 'reunião' ? '#fff' : colors.text }
              ]}>
                Reunião
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Status */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Status</Text>
          <View style={styles.statusContainer}>
            <TouchableOpacity
              style={[
                styles.statusButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                form.status === 'a_confirmar' && [styles.statusButtonActive, { backgroundColor: colors.warning, borderColor: colors.warning }]
              ]}
              onPress={() => updateForm('status', 'a_confirmar')}
            >
              <Ionicons 
                name="time" 
                size={20} 
                color={form.status === 'a_confirmar' ? '#fff' : colors.warning} 
              />
              <Text style={[
                styles.statusButtonText,
                { color: form.status === 'a_confirmar' ? '#fff' : colors.text },
                form.status === 'a_confirmar' && styles.statusButtonTextActive
              ]}>
                A Confirmar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.statusButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                form.status === 'confirmado' && [styles.statusButtonActive, { backgroundColor: colors.success, borderColor: colors.success }]
              ]}
              onPress={() => updateForm('status', 'confirmado')}
            >
              <Ionicons 
                name="checkmark-circle" 
                size={20} 
                color={form.status === 'confirmado' ? '#fff' : colors.success} 
              />
              <Text style={[
                styles.statusButtonText,
                { color: form.status === 'confirmado' ? '#fff' : colors.text },
                form.status === 'confirmado' && styles.statusButtonTextActive
              ]}>
                Confirmado
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.moreDetailsTitle, { color: colors.textSecondary }]}>
          Mais detalhes
        </Text>

        {/* Cidade e estado (opcionais) */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Cidade (opcional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.cidade}
            onChangeText={(text) => updateForm('cidade', text)}
            placeholder="Ex.: Rio de Janeiro"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Estado (opcional)</Text>
          <BrazilStateFieldButton
            selectedUf={form.estadoUf}
            onPress={() => setShowEstadoModal(true)}
            colors={colors}
          />
        </View>

        {/* Telefone do Contratante */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Telefone do Contratante</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.telefoneContratante}
            onChangeText={(text) => updateForm('telefoneContratante', maskPhone(text))}
            placeholder="(21) 99999-9999"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="next"
          />
        </View>

        {/* Descrição */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Descrição (Opcional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.descricao}
            onChangeText={(text) => updateForm('descricao', text)}
            placeholder="Detalhes sobre o evento..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCorrect={false}
            autoCapitalize="sentences"
            returnKeyType="default"
          />
        </View>

        {/* Descrição para visualizadores */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Descrição para visualizadores (Opcional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={form.descricaoViewer}
            onChangeText={(text) => updateForm('descricaoViewer', text)}
            placeholder="Informações que os colaboradores visualizadores poderão ver..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCorrect={false}
            autoCapitalize="sentences"
            returnKeyType="default"
          />
        </View>

        {/* Contrato (opcional) */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Contrato (opcional)</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Anexe PDF ou imagem do contrato. Você poderá abrir ou compartilhar nos detalhes do evento.
          </Text>
          {contractUri ? (
            <View style={[styles.contractPickedRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={22} color={colors.primary} />
              <Text style={[styles.contractPickedName, { color: colors.text }]} numberOfLines={1}>
                {contractName || 'Arquivo selecionado'}
              </Text>
              <TouchableOpacity onPress={clearContract} hitSlop={12}>
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.contractPickBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={pickContract}
              activeOpacity={0.85}
            >
              <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
              <Text style={[styles.contractPickBtnText, { color: colors.text }]}>Escolher arquivo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Seção de Despesas */}
        <View style={styles.inputGroup}>
          <View style={styles.despesasHeader}>
            <Text style={[styles.label, { color: colors.text }]}>Despesas do Evento</Text>
            <TouchableOpacity style={styles.addDespesaButton} onPress={addDespesa}>
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.addDespesaText}>Adicionar</Text>
            </TouchableOpacity>
          </View>

          {despesas.map((despesa, index) => (
            <View key={index} style={[styles.despesaItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.despesaHeader}>
                <Text style={[styles.despesaTitle, { color: colors.text }]}>Despesa {index + 1}</Text>
                <TouchableOpacity onPress={() => removeDespesa(index)}>
                  <Ionicons name="trash" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>

              <View style={styles.despesaFields}>
                <View style={styles.despesaField}>
                  <Text style={[styles.despesaLabel, { color: colors.text }]}>Nome *</Text>
                  <TextInput
                    style={[styles.despesaInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    value={despesa.nome}
                    onChangeText={(text) => updateDespesa(index, 'nome', text)}
                    placeholder="Ex: Transporte, Alimentação"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                <View style={styles.despesaField}>
                  <Text style={[styles.despesaLabel, { color: colors.text }]}>Valor (R$) *</Text>
                  <TextInput
                    style={[styles.despesaInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    value={despesa.valor ? formatCurrencyBRLInput(despesa.valor) : ''}
                    onChangeText={(text) => {
                      const numericValue = text.replace(/\D/g, '').slice(0, 11);
                      updateDespesa(index, 'valor', numericValue);
                    }}
                    placeholder="R$ 0,00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                  />
                </View>
              </View>

            </View>
          ))}

          {despesas.length === 0 && (
            <View style={styles.emptyDespesas}>
              <Ionicons name="receipt-outline" size={32} color={colors.border} />
              <Text style={[styles.emptyDespesasText, { color: colors.textSecondary }]}>
                Nenhuma despesa adicionada
              </Text>
              <Text style={[styles.emptyDespesasSubtext, { color: colors.textSecondary }]}>
                Toque em &quot;Adicionar&quot; para incluir despesas do evento
              </Text>
            </View>
          )}
        </View>

        {/* Botões */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => router.back()}
            disabled={isLoading}
          >
            <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancelar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }, isLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isLoading}
          >
            {isLoading ? (
              <Text style={styles.saveButtonText}>Salvando...</Text>
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text style={styles.saveButtonText}>Salvar Evento</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal para seleção de data */}
      <Modal
        visible={showDateModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Selecionar Data</Text>
              <TouchableOpacity
                onPress={() => setShowDateModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <DatePickerComponent
                selectedDate={form.data}
                onDateChange={(date) => updateForm('data', date)}
                visible={showDateModal}
                colors={colors}
              />
            </View>
            
            <View style={[styles.modalButtons, { paddingBottom: Math.max(insets.bottom, 20) + 30 }]}>
              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowDateModal(false)}
              >
                <Text style={styles.modalConfirmText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para seleção de horário de início */}
      <Modal
        visible={showTimeInicioModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTimeInicioModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Horário de Início</Text>
              <TouchableOpacity
                onPress={() => setShowTimeInicioModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <TimePickerComponent
              selectedTime={form.horarioInicio}
              onTimeChange={(time) => updateForm('horarioInicio', time)}
              colors={colors}
            />
            
            <View style={[styles.modalButtons, { paddingBottom: Math.max(insets.bottom, 20) + 30 }]}>
              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowTimeInicioModal(false)}
              >
                <Text style={styles.modalConfirmText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para seleção de horário de fim */}
      <Modal
        visible={showTimeFimModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTimeFimModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Horário de Fim</Text>
              <TouchableOpacity
                onPress={() => setShowTimeFimModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <TimePickerComponent
              selectedTime={form.horarioFim}
              onTimeChange={(time) => updateForm('horarioFim', time)}
              colors={colors}
            />
            
            <View style={[styles.modalButtons, { paddingBottom: Math.max(insets.bottom, 20) + 30 }]}>
              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowTimeFimModal(false)}
              >
                <Text style={styles.modalConfirmText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPreviousEventsModal}
        transparent
        animationType="slide"
        onRequestClose={closePreviousEventsModal}
        statusBarTranslucent
      >
        <GestureHandlerRootView style={styles.previousEventsRoot}>
          <Pressable
            style={styles.previousEventsBackdrop}
            onPress={closePreviousEventsModal}
          />
          <GestureDetector gesture={previousDismissPanGesture}>
            <Animated.View
              style={[
                styles.previousEventsSheet,
                previousSheetStyle,
                { backgroundColor: colors.surface, height: PREVIOUS_EVENTS_SHEET_HEIGHT },
              ]}
            >
              <View {...previousHandlePan.panHandlers}>
                <View style={styles.previousEventsHandleArea}>
                  <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
                </View>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    Usar evento anterior
                  </Text>
                  <TouchableOpacity
                    onPress={closePreviousEventsModal}
                    style={styles.modalCloseButton}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.previousEventsHint, { color: colors.textSecondary }]}>
                Toque em um evento para copiar o nome e o valor.
              </Text>
              {loadingPreviousEvents && recentSuggestions.length === 0 ? (
                <View style={styles.previousEventsEmpty}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : recentSuggestions.length === 0 ? (
                <View style={styles.previousEventsEmpty}>
                  <Text style={[styles.previousEventsEmptyText, { color: colors.textSecondary }]}>
                    Nenhum evento anterior neste perfil ainda.
                  </Text>
                </View>
              ) : (
                <GestureDetector gesture={previousListScrollGesture}>
                  <GHScrollView
                    style={styles.previousEventsList}
                    contentContainerStyle={{
                      paddingHorizontal: 20,
                      paddingBottom: Math.max(insets.bottom, 24) + 16,
                    }}
                    showsVerticalScrollIndicator
                    keyboardShouldPersistTaps="handled"
                    bounces
                    alwaysBounceVertical
                    onScroll={(event) => {
                      previousListScrollY.value = event.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                  >
                    {recentSuggestions.map((suggestion) => {
                      const valueLabel =
                        suggestion.value != null
                          ? formatCurrencyBRLFromAmount(suggestion.value)
                          : '';
                      return (
                        <TouchableOpacity
                          key={suggestion.name}
                          style={[
                            styles.previousEventRow,
                            { borderColor: colors.border, backgroundColor: colors.background },
                          ]}
                          onPress={() => applyRecentSuggestion(suggestion)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.previousEventRowText}>
                            <Text style={[styles.suggestionName, { color: colors.text }]} numberOfLines={2}>
                              {suggestion.name}
                            </Text>
                            {valueLabel ? (
                              <Text style={[styles.suggestionValue, { color: colors.primary }]}>
                                {valueLabel}
                              </Text>
                            ) : null}
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      );
                    })}
                  </GHScrollView>
                </GestureDetector>
              )}
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      </Modal>

      <BrazilStatePickerModal
        visible={showEstadoModal}
        onClose={() => setShowEstadoModal(false)}
        selectedUf={form.estadoUf}
        onSelect={(uf) => updateForm('estadoUf', uf ?? '')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
    minWidth: 72,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSaveButton: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  nameLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  nameLabel: {
    marginBottom: 0,
    flex: 1,
    marginRight: 12,
  },
  previousEventsLink: {
    fontSize: 13,
    fontWeight: '500',
  },
  moreDetailsTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 16,
  },
  previousEventsRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  previousEventsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  previousEventsSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  previousEventsHandleArea: {
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: 'center',
  },
  previousEventsHint: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  previousEventsList: {
    flex: 1,
  },
  previousEventRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previousEventRowText: {
    flex: 1,
    minWidth: 0,
  },
  previousEventsEmpty: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previousEventsEmptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: '600',
  },
  suggestionValue: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  input: {
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  dateButton: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateButtonText: {
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  chevronIcon: {
    marginLeft: 'auto',
  },
  statusContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  statusButton: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusButtonActive: {
    // Cores aplicadas dinamicamente
  },
  statusButtonText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  statusButtonTextActive: {
    color: '#fff',
  },
  tagContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  tagButton: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagButtonActive: {
    // Cor será definida dinamicamente baseada na tag
  },
  tagButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  tagButtonTextActive: {
    color: '#fff',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 40,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
  },
  textArea: {
    height: 100,
  },
  despesasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  addDespesaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#667eea',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addDespesaText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
    color: '#FFFFFF',
  },
  despesaItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  despesaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  despesaTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  despesaFields: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  despesaField: {
    flex: 1,
  },
  despesaLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  despesaInput: {
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  emptyDespesas: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyDespesasText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
    marginBottom: 4,
  },
  emptyDespesasSubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  contractPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  contractPickBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  contractPickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  contractPickedName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -5,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.25,
    shadowRadius: Platform.OS === 'android' ? 0 : 20,
    elevation: Platform.OS === 'android' ? 0 : 10,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalBody: {
    padding: 0,
  },
  datePickerContainer: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthYearLabel: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  weekdayHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  weekdayHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    width: '14.28%', // 100% / 7 dias
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  dayItem: {
    width: '14.28%', // 100% / 7 dias
    aspectRatio: 1,
    marginBottom: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dayItemSelected: {
    backgroundColor: '#667eea',
    borderRadius: 8,
  },
  dayItemEmpty: {
    backgroundColor: 'transparent',
  },
  dayItemText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },
  dayItemTextSelected: {
    color: '#fff',
  },
  dayNumberText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  dayNumberTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  pickerContainer: {
    flexDirection: 'row',
    height: 200,
    paddingHorizontal: 20,
  },
  pickerColumn: {
    flex: 1,
    marginHorizontal: 5,
  },
  pickerLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 10,
  },
  pickerScroll: {
    flex: 1,
  },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickerItemSelected: {
    backgroundColor: '#667eea',
  },
  pickerItemText: {
    fontSize: 16,
    color: '#666',
  },
  pickerItemTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  modalButtons: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalConfirmButton: {
    backgroundColor: '#667eea',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#667eea',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.3,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 4,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
  },
});
