import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { removeEventContractByUrl, uploadEventContractFile } from '../services/supabase/eventContractUploadService';
import { getEventById, updateEvent, UpdateEventData } from '../services/supabase/eventService';
import {
    extractNumericValueString,
    formatCurrencyBRLFromAmount,
    formatCurrencyBRLInput,
} from '../utils/currencyBRLInput';
import BrazilStatePickerModal, { BrazilStateFieldButton } from '../components/BrazilStatePickerModal';
import EventPaymentProgress, { parseOptionalPaidAmount } from '../components/EventPaymentProgress';
import { parseCityUf } from '../lib/brazilGeo';
import { setPendingEventUpdatedToast } from '../lib/pendingEventUpdatedToast';

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

/** Máscara (XX) XXXXX-XXXX para celular brasileiro (11 dígitos). */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

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

export default function EditarEventoScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const eventId = params.eventId as string;

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
    data: new Date(),
    // 00:00/00:00 significa "horário não definido"
    horarioInicio: createDefaultTime(0, 0),
    horarioFim: createDefaultTime(0, 0),
    status: 'a_confirmar',
    descricao: '',
    descricaoViewer: '',
    tag: 'evento', // Valor padrão
  });

  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeInicioModal, setShowTimeInicioModal] = useState(false);
  const [showTimeFimModal, setShowTimeFimModal] = useState(false);
  const [showEstadoModal, setShowEstadoModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [remoteContractUrl, setRemoteContractUrl] = useState<string | null>(null);
  const [remoteContractFileName, setRemoteContractFileName] = useState<string | null>(null);
  const [pendingContract, setPendingContract] = useState<{
    uri: string;
    name: string;
    mime: string | null;
  } | null>(null);
  const [removeContractRequested, setRemoveContractRequested] = useState(false);
  const [isInviteParticipationEvent, setIsInviteParticipationEvent] = useState(false);
  const [loadedAsUnconfirmed, setLoadedAsUnconfirmed] = useState(false);
  const [showConfirmedCongratsModal, setShowConfirmedCongratsModal] = useState(false);

  const getContractDisplayName = (url: string) => {
    const last = url.split('?')[0]?.split('#')[0]?.split('/').pop() || 'contrato';
    const decoded = (() => {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    })();

    const m = decoded.match(/^\d+_([^_]+)_[a-z0-9]{6,}\.([a-z0-9]{1,8})$/i);
    if (m) return `${m[1]}.${m[2]}`;
    return decoded;
  };

  // Obter usuário atual
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    };
    getCurrentUser();
  }, []);

  const loadEventData = useCallback(async () => {
    try {
      const result = await getEventById(eventId);
      
      if (result.success && result.event) {
        const event = result.event;
        
        // Parse da data
        const [year, month, day] = event.event_date.split('-').map(Number);
        const eventDate = new Date(year, month - 1, day);
        
        // Parse dos horários
        const [startHour, startMinute] = event.start_time.split(':').map(Number);
        const [endHour, endMinute] = event.end_time.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(startHour, startMinute, 0, 0);
        const endTime = new Date();
        endTime.setHours(endHour, endMinute, 0, 0);

        const rawCity = event.city || '';
        const colUf = event.state_uf;
        let cidade = rawCity.trim();
        let estadoUf = '';
        if (colUf != null && String(colUf).trim()) {
          estadoUf = String(colUf).trim().toUpperCase().slice(0, 2);
        } else {
          const parsed = parseCityUf(rawCity);
          cidade = parsed.cityLabel;
          estadoUf = parsed.uf || '';
        }

        setForm({
          nome: event.name,
          valor: event.value != null ? formatCurrencyBRLInput((event.value * 100).toString()) : '',
          valorPago: formatCurrencyBRLFromAmount(Number(event.paid_amount) || 0),
          cidade,
          estadoUf,
          telefoneContratante: maskPhone(event.contractor_phone || ''),
          data: eventDate,
          horarioInicio: startTime,
          horarioFim: endTime,
          status: (event.confirmed ? 'confirmado' : 'a_confirmar') as 'confirmado' | 'a_confirmar',
          descricao: event.description || '',
          descricaoViewer: event.viewer_description || '',
          tag: event.tag || 'evento', // Carregar tag existente ou usar padrão
        });
        setLoadedAsUnconfirmed(!event.confirmed);
        setRemoteContractUrl(event.contract_url ?? null);
        setRemoteContractFileName((event as any)?.contract_file_name ?? null);
        setIsInviteParticipationEvent(Boolean(event.convite_participacao_id));
        setPendingContract(null);
        setRemoveContractRequested(false);
      } else {
        Alert.alert('Erro', result.error || 'Erro ao carregar evento');
        router.back();
      }
    } catch (error: any) {
      Alert.alert(
        'Erro',
        `Erro ao carregar dados do evento.${error?.message ? ` Detalhes: ${error.message}` : ''}`
      );
      router.back();
    } finally {
      setIsLoadingEvent(false);
    }
  }, [eventId]);

  // Carregar dados do evento
  useEffect(() => {
    loadEventData();
  }, [loadEventData]);

  const pickContractFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setPendingContract({
        uri: asset.uri,
        name: asset.name ?? 'documento',
        mime: asset.mimeType ?? null,
      });
      setRemoveContractRequested(false);
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar o arquivo.');
    }
  };

  const clearPendingContract = () => {
    setPendingContract(null);
  };

  const handleSave = async () => {
    if (isInviteParticipationEvent) {
      Alert.alert(
        'Edição bloqueada',
        'Este evento foi criado a partir de um convite de participação e não pode ser alterado após o aceite.'
      );
      return;
    }

    if (!form.nome.trim()) {
      Alert.alert('Erro', 'Nome do evento é obrigatório');
      return;
    }
    if (!isInviteParticipationEvent && !form.valor.trim()) {
      Alert.alert('Erro', 'Valor é obrigatório');
      return;
    }

    const numericValue = extractNumericValueString(form.valor);
    if (!isInviteParticipationEvent && (!numericValue || isNaN(parseFloat(numericValue)))) {
      Alert.alert('Erro', 'Valor deve ser um número válido');
      return;
    }

    const paidAmount = parseOptionalPaidAmount(form.valorPago);
    if (
      paidAmount != null &&
      numericValue &&
      !isNaN(parseFloat(numericValue)) &&
      paidAmount > parseFloat(numericValue)
    ) {
      Alert.alert('Valor pago antecipado', 'O valor pago antecipado não pode ser maior que o valor do evento.');
      return;
    }

    setIsLoading(true);

    try {
      const oldUrl = remoteContractUrl ?? null;
      const updateData: UpdateEventData = {
        name: form.nome.trim(),
        description: form.descricao.trim() || undefined,
        viewer_description: form.descricaoViewer.trim() || undefined,
        ...(isInviteParticipationEvent ? {} : { value: parseFloat(numericValue) }),
        paid_amount: paidAmount,
        city: form.cidade.trim() || undefined,
        state_uf: form.estadoUf.trim()
          ? form.estadoUf.trim().toUpperCase().slice(0, 2)
          : null,
        contractor_phone: form.telefoneContratante.trim() || undefined,
        event_date: form.data.toISOString().split('T')[0],
        // Importante: manter padrão do banco (HH:MM) para não gerar "mudanças" falsas no histórico
        start_time: form.horarioInicio.toTimeString().split(' ')[0].substring(0, 5),
        end_time: form.horarioFim.toTimeString().split(' ')[0].substring(0, 5),
        confirmed: form.status === 'confirmado',
        tag: form.tag,
      };

      if (pendingContract) {
        const uploaded = await uploadEventContractFile(pendingContract.uri, {
          mimeType: pendingContract.mime,
          fileName: pendingContract.name,
        });
        if (!uploaded.success || !uploaded.url) {
          Alert.alert('Erro', uploaded.error || 'Não foi possível enviar o contrato.');
          return;
        }
        updateData.contract_url = uploaded.url;
        updateData.contract_file_name = pendingContract.name ?? null;
      } else if (removeContractRequested) {
        updateData.contract_url = null;
        updateData.contract_file_name = null;
      }

      const result = await updateEvent(eventId, updateData, currentUserId || undefined);

      if (result.success) {
        if (pendingContract && oldUrl) {
          const removed = await removeEventContractByUrl(oldUrl);
          if (!removed.success) {
            Alert.alert(
              'Aviso',
              `Contrato atualizado, mas não foi possível remover o arquivo antigo do Storage.${removed.error ? ` Detalhes: ${removed.error}` : ''}`
            );
          }
        }
        if (removeContractRequested && oldUrl) {
          const removed = await removeEventContractByUrl(oldUrl);
          if (!removed.success) {
            Alert.alert(
              'Aviso',
              `Contrato removido do evento, mas não foi possível remover o arquivo do Storage.${removed.error ? ` Detalhes: ${removed.error}` : ''}`
            );
          }
        }
        if (loadedAsUnconfirmed && form.status === 'confirmado') {
          setShowConfirmedCongratsModal(true);
        } else {
          setPendingEventUpdatedToast('Evento atualizado com sucesso!');
          router.back();
        }
      } else {
        const errorDetail =
          typeof result.error === 'string'
            ? result.error
            : result.error && typeof (result.error as any)?.message === 'string'
              ? (result.error as any).message
              : null;

        Alert.alert(
          'Ops, Desculpe!',
          `Não foi possível atualizar o evento.${errorDetail ? ` Detalhes: ${errorDetail}` : ' Por favor, tente novamente.'}`
        );
      }
    } catch (error: any) {
      const errorDetail =
        typeof error === 'string'
          ? error
          : error?.message || null;

      Alert.alert(
        'Erro',
        `Ocorreu um erro ao tentar editar o evento.${errorDetail ? ` Detalhes: ${errorDetail}` : ''}`
      );
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

  if (isLoadingEvent) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Editar Evento</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando evento...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Editar Evento</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Nome do Evento */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Nome do Evento *</Text>
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
            style={[
              styles.input,
              {
                backgroundColor: isInviteParticipationEvent ? colors.background : colors.surface,
                borderColor: colors.border,
                color: colors.text,
                opacity: isInviteParticipationEvent ? 0.8 : 1,
              },
            ]}
            value={form.valor}
            editable={!isInviteParticipationEvent}
            onChangeText={(text) => {
              if (isInviteParticipationEvent) return;
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

        {!isInviteParticipationEvent ? (
          <View style={[styles.inputGroup, { marginBottom: 32 }]}>
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
        ) : null}

        {/* Cidade e estado (opcionais) */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Cidade (opcional)</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
                opacity: isInviteParticipationEvent ? 0.8 : 1,
              },
            ]}
            value={form.cidade}
            editable={!isInviteParticipationEvent}
            onChangeText={(text) => updateForm('cidade', text)}
            placeholder="Ex.: Rio de Janeiro"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>
        <View style={[styles.inputGroup, { opacity: isInviteParticipationEvent ? 0.8 : 1 }]}>
          <Text style={[styles.label, { color: colors.text }]}>Estado (opcional)</Text>
          <BrazilStateFieldButton
            selectedUf={form.estadoUf}
            onPress={() => {
              if (!isInviteParticipationEvent) setShowEstadoModal(true);
            }}
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

        {/* Data */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Data do Evento *</Text>
          <TouchableOpacity
            style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setShowDateModal(true)}
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
            onPress={() => setShowTimeInicioModal(true)}
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
            onPress={() => setShowTimeFimModal(true)}
          >
            <Ionicons name="time" size={20} color={colors.primary} />
            <Text style={[styles.dateButtonText, { color: colors.text }]}>{formatTime(form.horarioFim)}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.primary} style={styles.chevronIcon} />
          </TouchableOpacity>
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

        {/* Contrato */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>Contrato (opcional)</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            PDF ou imagem. Nos detalhes do evento é possível abrir ou compartilhar o arquivo.
          </Text>
          {pendingContract ? (
            <View style={[styles.contractPickedRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={22} color={colors.primary} />
              <Text style={[styles.contractPickedName, { color: colors.text }]} numberOfLines={1}>
                Novo: {pendingContract.name}
              </Text>
              <TouchableOpacity onPress={clearPendingContract} hitSlop={12}>
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : removeContractRequested ? (
            <View style={[styles.contractPickedRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.contractPickedName, { color: colors.textSecondary }]}>
                Contrato será removido ao salvar
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setRemoveContractRequested(false);
                }}
                hitSlop={12}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Desfazer</Text>
              </TouchableOpacity>
            </View>
          ) : remoteContractUrl ? (
            <View style={[styles.contractActionsCol, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.contractActionsRow}>
                <Ionicons name="document-attach-outline" size={22} color={colors.primary} />
                <Text style={[styles.contractPickedName, { color: colors.text }]} numberOfLines={1}>
                  {remoteContractFileName || getContractDisplayName(remoteContractUrl)}
                </Text>
              </View>
              <View style={styles.contractBtnRow}>
                <TouchableOpacity
                  style={[styles.contractMiniBtn, { borderColor: colors.border }]}
                  onPress={() => void Linking.openURL(remoteContractUrl)}
                >
                  <Ionicons name="open-outline" size={18} color={colors.primary} />
                  <Text style={[styles.contractMiniBtnText, { color: colors.primary }]}>Abrir</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.contractMiniBtn, { borderColor: colors.border }]}
                  onPress={pickContractFile}
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.text} />
                  <Text style={[styles.contractMiniBtnText, { color: colors.text }]}>Substituir</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.contractMiniBtn, { borderColor: colors.error }]}
                  onPress={() => {
                    setRemoveContractRequested(true);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                  <Text style={[styles.contractMiniBtnText, { color: colors.error }]}>Remover</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.contractPickBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={pickContractFile}
              activeOpacity={0.85}
            >
              <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
              <Text style={[styles.contractPickBtnText, { color: colors.text }]}>Anexar contrato</Text>
            </TouchableOpacity>
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
                <Text style={styles.saveButtonText}>Salvar Alterações</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={showConfirmedCongratsModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowConfirmedCongratsModal(false);
          setPendingEventUpdatedToast('Evento confirmado. Muito sucesso!');
          router.back();
        }}
      >
        <View style={styles.congratsOverlay}>
          <View style={[styles.congratsCard, { backgroundColor: colors.surface }]}>
            <View style={styles.congratsIconWrap}>
              <Ionicons name="checkmark-circle" size={72} color={colors.success} />
            </View>
            <Text style={[styles.congratsTitle, { color: colors.text }]}>
              Parabéns!
            </Text>
            <Text style={[styles.congratsMessage, { color: colors.textSecondary }]}>
              Evento confirmado. Muito sucesso no seu show — vai ser incrível!
            </Text>
            <TouchableOpacity
              style={[styles.congratsButton, { backgroundColor: colors.success }]}
              activeOpacity={0.85}
              onPress={() => {
                setShowConfirmedCongratsModal(false);
                setPendingEventUpdatedToast('Evento confirmado. Muito sucesso!');
                router.back();
              }}
            >
              <Text style={styles.congratsButtonText}>Continuar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
            
            <View style={styles.modalButtons}>
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
            
            <View style={styles.modalButtons}>
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
            
            <View style={styles.modalButtons}>
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
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
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
  tagButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
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
  contractActionsCol: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  contractActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contractBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  contractMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  contractMiniBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  textArea: {
    height: 100,
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
    borderBottomColor: 'transparent',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
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
    textAlign: 'center',
    width: '14.28%',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  dayItem: {
    width: '14.28%',
    aspectRatio: 1,
    marginBottom: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dayItemSelected: {
    borderRadius: 8,
  },
  dayItemEmpty: {
    backgroundColor: 'transparent',
  },
  dayNumberText: {
    fontSize: 16,
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
    // Cores aplicadas dinamicamente
  },
  pickerItemText: {
    fontSize: 16,
  },
  pickerItemTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  modalButtons: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingBottom: 34,
  },
  modalConfirmButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
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
  congratsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  congratsCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    alignItems: 'center',
  },
  congratsIconWrap: {
    marginBottom: 12,
  },
  congratsTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  congratsMessage: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 22,
  },
  congratsButton: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  congratsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
