import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Clipboard,
    FlatList,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OptimizedImage from '../../components/OptimizedImage';
import PermissionModal from '../../components/PermissionModal';
import PremiumTrialUpsellModal from '../../components/PremiumTrialUpsellModal';
import { useActiveArtistContext } from '../../contexts/ActiveArtistContext';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useSharedTabMonth } from '../../contexts/SharedTabMonthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { formatCalendarDate } from '../../lib/dateUtils';
import {
  extractNumericValueString,
  formatCurrencyBRLFromAmount,
  formatCurrencyBRLInput,
} from '../../utils/currencyBRLInput';
import { supabase } from '../../lib/supabase';
import { getCurrentUser } from '../../services/supabase/authService';
import {
  generateFinancialReport,
  generateYearlyFinancialReport,
  type YearlyReportMonthBlock,
} from '../../services/financialReportService';
import {
  deleteArtistMonthRevenueGoal,
  getArtistMonthRevenueGoal,
  upsertArtistMonthRevenueGoal,
} from '../../services/supabase/artistMonthRevenueGoalService';
import { getEventsByMonth, getEventsByYear } from '../../services/supabase/eventService';
import {
  deleteStandaloneExpense,
  getExpenseTotalsByEventIds,
  getExpensesGroupedByEventIds,
  getStandaloneExpensesByArtist,
  getStandaloneExpensesByArtistYear,
} from '../../services/supabase/expenseService';
import {
  checkUserSubscriptionFromTable,
  consumeFinancialTrialAction,
  getFinancialTrialStatus,
} from '../../services/supabase/userService';
import { maybeShowConnectionError } from '../../utils/maybeShowConnectionError';
import { useNotifications } from '../../services/useNotifications';
// import * as FileSystem from 'expo-file-system';

interface EventWithExpenses {
  id: string;
  name: string;
  event_date: string;
  value?: number;
  created_by?: string;
  expenses: any[];
  totalExpenses: number;
  city?: string;
}

type FinanceViewMode = 'month' | 'year';

interface YearMonthSummary {
  monthIndex: number;
  eventCount: number;
  revenueFromEvents: number;
  standaloneIncome: number;
  eventLinkedExpenses: number;
  standaloneExpensesPositive: number;
}

function calendarMonthIndexFromDbDate(dateStr: string | undefined | null): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return month - 1;
}

function emptyYearSummaries(): YearMonthSummary[] {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    eventCount: 0,
    revenueFromEvents: 0,
    standaloneIncome: 0,
    eventLinkedExpenses: 0,
    standaloneExpensesPositive: 0,
  }));
}

const WEEKDAY_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** Uma linha por evento: 08/05 (Sex) – Nome • Cidade; anexa cachê só se `includeValueWhenPresent` for true. */
function formatAgendaExportTextLine(
  event: { name: string; event_date: string; city?: string | null; value?: number | null },
  formatCurrency: (value: number) => string,
  includeValueWhenPresent: boolean,
): string {
  const dateStr = event.event_date;
  if (!dateStr || typeof dateStr !== 'string') {
    return event.name;
  }
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    return event.name;
  }
  const [y, month, day] = parts;
  const date = new Date(y, month - 1, day);
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dow = WEEKDAY_SHORT_PT[date.getDay()];
  const cityTrim = event.city?.trim();
  const title = cityTrim ? `${event.name} • ${cityTrim}` : event.name;
  let line = `${dd}/${mm} (${dow}) – ${title}`;
  const v = event.value;
  if (
    includeValueWhenPresent &&
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v > 0
  ) {
    line += ` — ${formatCurrency(v)}`;
  }
  return line;
}

export default function FinanceiroScreen() {
  const { colors, isDarkMode } = useTheme();
  const receitaAzul = isDarkMode ? '#60a5fa' : '#2563eb';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { viewedMonthDate: selectedDate, navigateMonth, setViewedMonthDate } = useSharedTabMonth();
  const [events, setEvents] = useState<EventWithExpenses[]>([]);
  const [standaloneExpenses, setStandaloneExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { activeArtist, refreshActiveArtist } = useActiveArtistContext();
  const { isAdmin, permissionsLoaded } = usePermissions();
  const { unreadCount, loadUnreadCount } = useNotifications();
  const [hasAnyArtist, setHasAnyArtist] = useState(false);
  const hasAccess = permissionsLoaded ? isAdmin : null;
  const isCheckingAccess = Boolean(activeArtist) && !permissionsLoaded;
  const [monthRevenueGoal, setMonthRevenueGoal] = useState<number | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalInputText, setGoalInputText] = useState('');
  const [premiumTrialModal, setPremiumTrialModal] = useState<{
    visible: boolean;
    message: string;
    title?: string;
  }>({ visible: false, message: '' });

  const [financeViewMode, setFinanceViewMode] = useState<FinanceViewMode>('month');
  const [annualSummaryYear, setAnnualSummaryYear] = useState(() => selectedDate.getFullYear());
  const [yearMonthSummaries, setYearMonthSummaries] = useState<YearMonthSummary[]>(emptyYearSummaries);
  const financeFocusedRef = useRef(false);
  const financeAbortRef = useRef<AbortController | null>(null);

  const currentMonth = selectedDate.getMonth();
  const currentYear = selectedDate.getFullYear();
  

  // Obter usuário atual
  useEffect(() => {
    const loadUserId = async () => {
      const { user, error } = await getCurrentUser();
      if (user?.id) {
        setCurrentUserId(user.id);
        return;
      }
      if (maybeShowConnectionError(null, error)) {
        return;
      }
      setCurrentUserId(null);
    };
    void loadUserId();
  }, []);


  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Verificar se usuário tem artistas disponíveis
  useEffect(() => {
    checkIfUserHasArtists();
  }, []);

  const checkIfUserHasArtists = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('artist_members')
        .select('artist_id')
        .eq('user_id', user.id)
        .limit(1);

      setHasAnyArtist(!error && data && data.length > 0);
    } catch (error) {
      // Erro ao verificar artistas
    }
  };

  const loadMonthRevenueGoal = React.useCallback(async () => {
    if (!activeArtist?.id || !currentUserId) {
      setMonthRevenueGoal(null);
      return;
    }
    const { goal } = await getArtistMonthRevenueGoal(
      activeArtist.id,
      currentYear,
      currentMonth
    );
    setMonthRevenueGoal(goal);
  }, [activeArtist?.id, currentUserId, currentYear, currentMonth]);


  const loadFinancialData = React.useCallback(async () => {
    if (!activeArtist || !financeFocusedRef.current) {
      return;
    }

    financeAbortRef.current?.abort();
    const abort = new AbortController();
    financeAbortRef.current = abort;

    try {
      setIsLoading(true);

      const { events: monthEvents, error: eventsError, aborted } = await getEventsByMonth(
        activeArtist.id,
        currentYear,
        currentMonth,
        abort.signal
      );
      if (aborted || abort.signal.aborted) return;

      if (eventsError) {
        if (!maybeShowConnectionError(null, eventsError)) {
          Alert.alert('Erro ao Carregar Eventos', eventsError || 'Não foi possível carregar os eventos do mês.');
        }
        return;
      }

      const ids = (monthEvents || []).map((event) => event.id);
      const { byEventId, aborted: expensesAborted } = await getExpensesGroupedByEventIds(ids, abort.signal);
      if (expensesAborted || abort.signal.aborted) return;

      const eventsWithExpenses = (monthEvents || []).map((event) => {
        const expenses = byEventId?.[event.id] || [];
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.value, 0);
        return {
          ...event,
          expenses,
          totalExpenses,
        };
      });

      setEvents(eventsWithExpenses);

      const { success: expensesSuccess, expenses: standalone, aborted: standaloneAborted } = await getStandaloneExpensesByArtist(
        activeArtist.id,
        currentMonth,
        currentYear,
        abort.signal
      );
      if (standaloneAborted || abort.signal.aborted) return;

      if (expensesSuccess && standalone) {
        setStandaloneExpenses(standalone);
      } else {
        setStandaloneExpenses([]);
      }
    } catch (error: unknown) {
      if (!maybeShowConnectionError(error)) {
        const msg =
          error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : '';
        Alert.alert(
          'Erro ao Carregar Finanças',
          msg || 'Ocorreu um erro inesperado ao carregar os dados financeiros. Tente novamente.',
        );
      }
    } finally {
      if (!abort.signal.aborted) setIsLoading(false);
    }
  }, [activeArtist, currentYear, currentMonth]);

  const loadAnnualFinancialData = React.useCallback(async () => {
    if (!activeArtist || !financeFocusedRef.current) {
      return;
    }

    financeAbortRef.current?.abort();
    const abort = new AbortController();
    financeAbortRef.current = abort;

    try {
      setIsLoading(true);

      const { events: yearEvents, error: eventsError, aborted } = await getEventsByYear(
        activeArtist.id,
        annualSummaryYear,
        abort.signal
      );
      if (aborted || abort.signal.aborted) return;

      if (eventsError) {
        if (!maybeShowConnectionError(null, eventsError)) {
          Alert.alert('Erro ao Carregar Eventos', eventsError || 'Não foi possível carregar os eventos do ano.');
        }
        return;
      }

      const ids = (yearEvents || []).map((e) => e.id);
      const { success: totOk, totalsByEventId, error: totErr, aborted: totAborted } = await getExpenseTotalsByEventIds(
        ids,
        abort.signal
      );
      if (totAborted || abort.signal.aborted) return;

      if (!totOk || !totalsByEventId) {
        if (!maybeShowConnectionError(null, totErr)) {
          Alert.alert('Erro', totErr || 'Não foi possível carregar despesas dos eventos.');
        }
        return;
      }

      const { success: stOk, expenses: standaloneYear, aborted: stAborted } = await getStandaloneExpensesByArtistYear(
        activeArtist.id,
        annualSummaryYear,
        abort.signal
      );
      if (stAborted || abort.signal.aborted) return;

      const buckets = emptyYearSummaries();

      for (const event of yearEvents || []) {
        const mi = calendarMonthIndexFromDbDate(event.event_date);
        if (mi === null) continue;
        buckets[mi].eventCount += 1;
        buckets[mi].revenueFromEvents += event.value || 0;
        buckets[mi].eventLinkedExpenses += totalsByEventId[event.id] || 0;
      }

      if (stOk && standaloneYear) {
        for (const row of standaloneYear) {
          const mi = calendarMonthIndexFromDbDate(row.date || '');
          if (mi === null) continue;
          if (row.value > 0) {
            buckets[mi].standaloneExpensesPositive += row.value;
          } else if (row.value < 0) {
            buckets[mi].standaloneIncome += Math.abs(row.value);
          }
        }
      }

      setYearMonthSummaries(buckets);
    } catch (error: unknown) {
      if (!maybeShowConnectionError(error)) {
        const msg =
          error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : '';
        Alert.alert(
          'Erro ao Carregar Finanças',
          msg || 'Ocorreu um erro inesperado ao carregar o resumo anual. Tente novamente.',
        );
      }
    } finally {
      if (!abort.signal.aborted) setIsLoading(false);
    }
  }, [activeArtist, annualSummaryYear]);

  // Só carrega com a aba aberta. No mount das tabs isso competia com o Feed
  // (dezenas de requests de despesa por evento e a busca de artistas ficava na fila).
  useFocusEffect(
    React.useCallback(() => {
      financeFocusedRef.current = true;
      void loadUnreadCount();
      if (!activeArtist || !permissionsLoaded || !isAdmin) {
        return () => {
          financeFocusedRef.current = false;
          financeAbortRef.current?.abort();
        };
      }
      if (financeViewMode === 'month') {
        void loadFinancialData();
        if (activeArtist.id && currentUserId) {
          void loadMonthRevenueGoal();
        }
      } else {
        void loadAnnualFinancialData();
      }
      return () => {
        financeFocusedRef.current = false;
        financeAbortRef.current?.abort();
      };
    }, [
      activeArtist?.id,
      permissionsLoaded,
      isAdmin,
      financeViewMode,
      currentMonth,
      currentYear,
      annualSummaryYear,
      currentUserId,
      loadMonthRevenueGoal,
      loadFinancialData,
      loadAnnualFinancialData,
      loadUnreadCount,
    ])
  );

  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) {
      return 'Data não informada';
    }
    return formatCalendarDate(dateString);
  };


  const openPremiumTrialModal = (message: string, title?: string) => {
    setPremiumTrialModal({ visible: true, message, title });
  };

  const closePremiumTrialModal = () => {
    setPremiumTrialModal((s) => ({ ...s, visible: false }));
  };

  /** Abre o modal de exportação: Premium ou ainda há exportações trial. */
  const ensureFinanceExportModalAllowed = async (userId: string): Promise<boolean> => {
    const { isActive, error: subErr } = await checkUserSubscriptionFromTable(userId);
    if (subErr) {
      Alert.alert('Erro', `Não foi possível verificar sua assinatura. ${subErr}`);
      return false;
    }
    if (isActive) return true;

    const trial = await getFinancialTrialStatus();
    if (trial.error === 'rpc_missing') {
      Alert.alert(
        'Configuração',
        'O período de testes gratuito ainda não está ativo no servidor. Aplique o script database/free_financial_trial.sql no Supabase.',
      );
      return false;
    }
    if (trial.error) {
      Alert.alert('Erro', `Não foi possível verificar o período de testes. ${trial.error}`);
      return false;
    }
    if (trial.exportsRemaining > 0) return true;

    openPremiumTrialModal(
      'Você usou todas as exportações incluídas no período de testes. Com o Premium você gera PDFs e relatórios em texto sem limite.',
      'Exportações gratuitas esgotadas',
    );
    return false;
  };

  /** Antes de gerar PDF/cópia: Premium ou consome 1 exportação trial. */
  const consumeExportTrialIfNeeded = async (userId: string): Promise<boolean> => {
    const { isActive } = await checkUserSubscriptionFromTable(userId);
    if (isActive) return true;

    const consumed = await consumeFinancialTrialAction('export');
    if (consumed.ok) return true;

    if (consumed.reason === 'exhausted_exports') {
      openPremiumTrialModal(
        'Você usou todas as exportações incluídas no período de testes. Com o Premium você gera PDFs e relatórios em texto sem limite.',
        'Exportações gratuitas esgotadas',
      );
      return false;
    }
    if (consumed.error === 'rpc_missing') {
      Alert.alert(
        'Configuração',
        'O período de testes gratuito ainda não está ativo no servidor. Aplique o script database/free_financial_trial.sql no Supabase.',
      );
      return false;
    }
    if (consumed.error) {
      Alert.alert('Erro', consumed.error);
      return false;
    }
    openPremiumTrialModal(
      'Não foi possível concluir esta exportação. Assine o Premium para continuar exportando relatórios sem limite.',
      'Premium necessário',
    );
    return false;
  };

  const openFinanceDetails = async () => {
    if (!activeArtist) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      Alert.alert('Erro', 'Faça login novamente.');
      return;
    }

    const { isActive, error: subErr } = await checkUserSubscriptionFromTable(uid);
    if (subErr) {
      Alert.alert('Erro', `Não foi possível verificar sua assinatura. ${subErr}`);
      return;
    }
    if (isActive) {
      router.push({
        pathname: '/financeiro-detalhes',
        params: { month: String(currentMonth), year: String(currentYear) },
      });
      return;
    }

    const trial = await getFinancialTrialStatus();
    if (trial.error === 'rpc_missing') {
      Alert.alert(
        'Configuração',
        'O período de testes gratuito ainda não está ativo no servidor. Aplique o script database/free_financial_trial.sql no Supabase.',
      );
      return;
    }
    if (trial.error) {
      Alert.alert('Erro', `Não foi possível verificar o período de testes. ${trial.error}`);
      return;
    }

    if (trial.detailOpensRemaining <= 0) {
      openPremiumTrialModal(
        'Você usou todas as aberturas gratuitas da tela de detalhes. Com o Premium você acessa gráficos e análises sempre que quiser.',
        'Visualizações gratuitas esgotadas',
      );
      return;
    }

    const cons = await consumeFinancialTrialAction('detail_open');
    if (!cons.ok) {
      if (cons.reason === 'exhausted_details') {
        openPremiumTrialModal(
          'Você usou todas as aberturas gratuitas da tela de detalhes. Com o Premium você acessa gráficos e análises sempre que quiser.',
          'Visualizações gratuitas esgotadas',
        );
        return;
      }
      if (cons.error === 'rpc_missing') {
        Alert.alert(
          'Configuração',
          'O período de testes gratuito ainda não está ativo no servidor. Aplique o script database/free_financial_trial.sql no Supabase.',
        );
        return;
      }
      Alert.alert('Erro', cons.error || 'Não foi possível abrir os detalhes.');
      return;
    }

    router.push({
      pathname: '/financeiro-detalhes',
      params: { month: String(currentMonth), year: String(currentYear) },
    });
  };

  const openFinanceInsights = () => {
    if (!activeArtist) return;
    if (financeViewMode === 'year') {
      router.push({
        pathname: '/financeiro-insights',
        params: { scope: 'year', year: String(annualSummaryYear) },
      });
      return;
    }
    router.push({
      pathname: '/financeiro-insights',
      params: {
        scope: 'month',
        year: String(currentYear),
        month: String(currentMonth),
      },
    });
  };

  const handleExportFinancialReport = async () => {
    if (!activeArtist) return;
    if (financeViewMode === 'month' && events.length === 0) {
      Alert.alert('Aviso', 'Não há eventos para exportar neste mês.');
      return;
    }
    if (financeViewMode === 'year' && !yearHasExportableData) {
      Alert.alert('Aviso', 'Não há movimentação neste ano para exportar.');
      return;
    }

    const { user, error: authErr } = await getCurrentUser();
    if (maybeShowConnectionError(null, authErr)) {
      return;
    }
    if (!user?.id) {
      Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
      return;
    }

    if (!(await ensureFinanceExportModalAllowed(user.id))) return;

    setShowExportModal(true);
  };

  const generateReport = async (includeFinancials: boolean) => {
    if (!activeArtist) return;

    const { user, error: authErr } = await getCurrentUser();
    if (maybeShowConnectionError(null, authErr)) {
      return;
    }
    if (!user?.id) {
      Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
      return;
    }
    if (!(await consumeExportTrialIfNeeded(user.id))) return;

    setShowExportModal(false);

    try {
      if (financeViewMode === 'year') {
        const blocks = await fetchYearExportBlocks();
        if (!blocks) return;
        const hasAny = blocks.some(
          (b) =>
            b.events.length > 0 || b.standaloneIncome.length > 0 || b.standaloneExpenses.length > 0
        );
        if (!hasAny) {
          Alert.alert('Aviso', 'Não há dados neste ano para exportar.');
          return;
        }
        const result = await generateYearlyFinancialReport({
          year: annualSummaryYear,
          artistName: activeArtist.name,
          includeFinancials,
          months: blocks,
        });
        if (result.success && result.uri) {
          await Sharing.shareAsync(result.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Compartilhar relatório anual',
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert('Erro', result.error || 'Não foi possível gerar o PDF');
        }
        return;
      }

      const standaloneExpensesOnly = standaloneExpenses.filter((item) => item.value > 0);
      const standaloneIncome = standaloneExpenses.filter((item) => item.value < 0);

      const result = await generateFinancialReport({
        events,
        month: currentMonth,
        year: currentYear,
        artistName: activeArtist.name,
        includeFinancials,
        standaloneIncome: standaloneIncome.map((item) => ({
          id: item.id,
          description: item.description,
          value: item.value,
          date: item.date,
          category: item.category,
        })),
        standaloneExpenses: standaloneExpensesOnly.map((item) => ({
          id: item.id,
          description: item.description,
          value: item.value,
          date: item.date,
          category: item.category,
        })),
      });

      if (result.success && result.uri) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Compartilhar Relatório Financeiro',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Erro', result.error || 'Não foi possível gerar o PDF');
      }
    } catch (error: unknown) {
      const msg =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Erro ao gerar o documento';
      Alert.alert('Erro', msg);
    }
  };

  const copyAsText = async (includeFinancials: boolean) => {
    if (!activeArtist) return;

    const { user, error: authErr } = await getCurrentUser();
    if (maybeShowConnectionError(null, authErr)) {
      return;
    }
    if (!user?.id) {
      Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
      return;
    }
    if (!(await consumeExportTrialIfNeeded(user.id))) return;

    setShowExportModal(false);

    const formatCurrency = (value: number) => {
      return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });
    };

    if (financeViewMode === 'year') {
      const blocks = await fetchYearExportBlocks();
      if (!blocks) return;
      const hasAny = blocks.some(
        (b) =>
          b.events.length > 0 || b.standaloneIncome.length > 0 || b.standaloneExpenses.length > 0
      );
      if (!hasAny) {
        Alert.alert('Aviso', 'Não há dados neste ano para copiar.');
        return;
      }

      let yearText = '';

      for (const block of blocks) {
        const has =
          block.events.length > 0 ||
          block.standaloneIncome.length > 0 ||
          block.standaloneExpenses.length > 0;
        if (!has) continue;

        const sorted = [...block.events].sort((a, b) => a.event_date.localeCompare(b.event_date));
        sorted.forEach((event) => {
          yearText += `${formatAgendaExportTextLine(event, formatCurrency, includeFinancials)}\n`;
        });
      }

      Clipboard.setString(yearText);
      Alert.alert('✅ Copiado!', 'Relatório anual copiado para a área de transferência. Cole em qualquer aplicativo de mensagem.');
      return;
    }

    let text = '';
    const sorted = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date));
    sorted.forEach((event) => {
      text += `${formatAgendaExportTextLine(event, formatCurrency, includeFinancials)}\n`;
    });

    Clipboard.setString(text);
    Alert.alert('✅ Copiado!', 'Relatório copiado para a área de transferência. Cole em qualquer aplicativo de mensagem.');
  };

  // ✅ VERIFICAÇÃO DE SEGURANÇA: Cálculos financeiros só se tiver acesso
  const totalRevenue = hasAccess 
    ? events.reduce((sum, event) => sum + (event.value || 0), 0) 
    : 0;
  
  const eventsExpenses = hasAccess 
    ? events.reduce((sum, event) => sum + event.totalExpenses, 0) 
    : 0;
  
  // Separar despesas (valor > 0) e receitas (valor < 0)
  const standaloneExpensesOnly = standaloneExpenses.filter(item => item.value > 0);
  const standaloneIncome = standaloneExpenses.filter(item => item.value < 0);
  
  const standaloneExpensesTotal = hasAccess
    ? standaloneExpensesOnly.reduce((sum, expense) => sum + (expense.value || 0), 0)
    : 0;
  
  const standaloneIncomeTotal = hasAccess
    ? Math.abs(standaloneIncome.reduce((sum, income) => sum + (income.value || 0), 0))
    : 0;
  
  const totalExpenses = eventsExpenses + standaloneExpensesTotal;
  const totalRevenueWithIncome = totalRevenue + standaloneIncomeTotal;
  const netProfit = totalRevenueWithIncome - totalExpenses;

  const goalProgress =
    monthRevenueGoal != null && monthRevenueGoal > 0
      ? Math.min(1, totalRevenueWithIncome / monthRevenueGoal)
      : 0;
  const goalPercentLabel =
    monthRevenueGoal != null && monthRevenueGoal > 0
      ? Math.min(999, Math.round((totalRevenueWithIncome / monthRevenueGoal) * 100))
      : 0;

  const yearTotals = useMemo(() => {
    return yearMonthSummaries.reduce(
      (acc, m) => {
        const revenue = m.revenueFromEvents + m.standaloneIncome;
        const expenses = m.eventLinkedExpenses + m.standaloneExpensesPositive;
        return {
          eventCount: acc.eventCount + m.eventCount,
          totalRevenue: acc.totalRevenue + revenue,
          totalExpenses: acc.totalExpenses + expenses,
          netProfit: acc.netProfit + (revenue - expenses),
        };
      },
      { eventCount: 0, totalRevenue: 0, totalExpenses: 0, netProfit: 0 }
    );
  }, [yearMonthSummaries]);

  const yearHasExportableData = useMemo(() => {
    return yearMonthSummaries.some(
      (r) =>
        r.eventCount > 0 ||
        r.revenueFromEvents + r.standaloneIncome + r.eventLinkedExpenses + r.standaloneExpensesPositive > 0
    );
  }, [yearMonthSummaries]);

  const fetchYearExportBlocks = React.useCallback(async (): Promise<YearlyReportMonthBlock[] | null> => {
    if (!activeArtist) return null;
    const y = annualSummaryYear;
    const { events: yearEvents, error: evErr } = await getEventsByYear(activeArtist.id, y);
    if (evErr) {
      if (!maybeShowConnectionError(null, evErr)) {
        Alert.alert('Erro', evErr || 'Não foi possível carregar os eventos do ano.');
      }
      return null;
    }
    const list = yearEvents || [];
    const ids = list.map((e) => e.id);
    const { success, byEventId, error: grpErr } = await getExpensesGroupedByEventIds(ids);
    if (!success || !byEventId) {
      if (!maybeShowConnectionError(null, grpErr)) {
        Alert.alert('Erro', grpErr || 'Não foi possível carregar despesas dos eventos.');
      }
      return null;
    }

    const eventsWithExpenses: EventWithExpenses[] = list.map((event) => {
      const expList = byEventId[event.id] || [];
      const totalExpenses = expList.reduce((s, e) => s + (e.value || 0), 0);
      return {
        ...event,
        expenses: expList.map((e) => ({
          ...e,
          name: (e.name || e.description || 'Despesa').trim(),
        })),
        totalExpenses,
      };
    });

    const { success: stOk, expenses: standaloneYear } = await getStandaloneExpensesByArtistYear(
      activeArtist.id,
      y
    );
    const standalone = stOk && standaloneYear ? standaloneYear : [];

    const mapTx = (item: (typeof standalone)[0]) => ({
      id: item.id,
      description: item.description || '',
      value: item.value,
      date: item.date || '',
      category: item.category,
    });

    const blocks: YearlyReportMonthBlock[] = [];
    for (let m = 0; m < 12; m++) {
      const monthEvents = eventsWithExpenses.filter(
        (e) => calendarMonthIndexFromDbDate(e.event_date) === m
      );
      const monthStandalone = standalone.filter(
        (row) => calendarMonthIndexFromDbDate(row.date || '') === m
      );
      const inc = monthStandalone.filter((r) => r.value < 0).map(mapTx);
      const exp = monthStandalone.filter((r) => r.value > 0).map(mapTx);
      blocks.push({
        monthIndex: m,
        events: monthEvents,
        standaloneIncome: inc,
        standaloneExpenses: exp,
      });
    }
    return blocks;
  }, [activeArtist, annualSummaryYear]);

  const goToMonthFromAnnual = (monthIndex: number) => {
    setViewedMonthDate(new Date(annualSummaryYear, monthIndex, 1));
    setFinanceViewMode('month');
  };

  const openGoalModal = () => {
    setGoalInputText(
      monthRevenueGoal != null && monthRevenueGoal > 0
        ? formatCurrencyBRLFromAmount(monthRevenueGoal)
        : ''
    );
    setShowGoalModal(true);
  };

  const saveGoalFromModal = async () => {
    if (!activeArtist || !currentUserId) {
      Alert.alert('Sessão', 'Entre na conta para salvar a meta.');
      return;
    }
    const raw = extractNumericValueString(goalInputText);
    const n = raw ? parseFloat(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
      return;
    }
    const { success, error } = await upsertArtistMonthRevenueGoal(
      activeArtist.id,
      currentYear,
      currentMonth,
      n,
      currentUserId
    );
    if (!success) {
      const friendly =
        error && /row-level security|RLS|permission denied|violates row-level/i.test(error)
          ? 'Apenas administradores podem alterar a meta.'
          : error || 'Tente novamente.';
      Alert.alert('Não foi possível salvar', friendly);
      return;
    }
    setMonthRevenueGoal(n);
    setShowGoalModal(false);
  };

  const removeGoal = async () => {
    if (!activeArtist || !currentUserId) return;
    const { success, error } = await deleteArtistMonthRevenueGoal(
      activeArtist.id,
      currentYear,
      currentMonth
    );
    if (!success) {
      const friendly =
        error && /row-level security|RLS|permission denied|violates row-level/i.test(error)
          ? 'Apenas administradores podem remover a meta.'
          : error || 'Tente novamente.';
      Alert.alert('Não foi possível remover', friendly);
      return;
    }
    setMonthRevenueGoal(null);
    setShowGoalModal(false);
  };

  const handleDeleteStandaloneExpense = async (expenseId: string) => {
    if (!hasAccess) {
      setShowPermissionModal(true);
      return;
    }

    Alert.alert(
      'Confirmar Exclusão',
      'Tem certeza que deseja excluir esta despesa?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            const { success, error } = await deleteStandaloneExpense(expenseId);
            if (success) {
              // Recarregar dados
              loadFinancialData();
              Alert.alert('Sucesso', 'Despesa excluída com sucesso!');
            } else {
              Alert.alert('Erro', error || 'Não foi possível excluir a despesa');
            }
          }
        }
      ]
    );
  };

  const renderExpense = ({ item }: { item: any }) => (
    <View style={[styles.expenseItem, { backgroundColor: colors.secondary }]}>
      <View style={styles.expenseInfo}>
        <Text style={[styles.expenseName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.expenseValue, { color: colors.error }]}>{formatCurrency(item.value)}</Text>
      </View>
    </View>
  );


  const renderEvent = ({ item }: { item: EventWithExpenses }) => (
    <View 
      style={[styles.eventCard, { backgroundColor: colors.surface }]}
    >
      <View style={styles.eventHeader}>
        <View style={styles.eventInfo}>
          <View style={styles.eventNameContainer}>
            <Text style={[styles.eventName, { color: colors.text }]}>{item.name}</Text>
            {!hasAccess && (
              <Ionicons name="lock-closed" size={16} color={colors.textSecondary} style={{ marginLeft: 8 }} />
            )}
          </View>
          <Text style={[styles.eventDate, { color: colors.textSecondary }]}>{formatDate(item.event_date)}</Text>
        </View>
        {hasAccess ? (
          <View style={styles.eventValues}>
            <View style={styles.eventValueRow}>
              <Text style={[styles.eventValueLabel, { color: colors.textSecondary }]}>Receita:</Text>
              <Text style={[styles.eventRevenue, { color: receitaAzul }]}>
                {formatCurrency(item.value || 0)}
              </Text>
            </View>
            {item.totalExpenses > 0 && (
              <View style={styles.eventValueRow}>
                <Text style={[styles.eventValueLabel, { color: colors.textSecondary }]}>Despesas:</Text>
                <Text style={[styles.eventExpenses, { color: colors.error }]}>
                  -{formatCurrency(item.totalExpenses)}
                </Text>
              </View>
            )}
            <View style={[styles.eventValueRow, styles.eventNetRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.eventNetLabel, { color: colors.text }]}>Líquido:</Text>
              <Text style={[styles.eventNet, { color: ((item.value || 0) - item.totalExpenses) >= 0 ? colors.success : colors.error }]}>
                {formatCurrency((item.value || 0) - item.totalExpenses)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.eventValues}>
            <View style={[styles.lockedInfo, { backgroundColor: colors.background }]}>
              <Ionicons name="lock-closed" size={20} color={colors.textSecondary} />
              <Text style={[styles.lockedText, { color: colors.textSecondary }]}>Valores ocultos</Text>
            </View>
          </View>
        )}
      </View>
      
      {hasAccess && item.expenses.length > 0 && (
        <View style={[styles.expensesSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.expensesTitle, { color: colors.text }]}>Despesas:</Text>
          <FlatList
            data={item.expenses}
            renderItem={renderExpense}
            keyExtractor={(expense) => expense.id}
            scrollEnabled={false}
          />
        </View>
      )}
    </View>
  );

  const notificationBtn = (
    <TouchableOpacity
      style={styles.notificationButton}
      onPress={() => router.push('/notificacoes')}
    >
      <Ionicons name="notifications-outline" size={22} color={colors.primary} />
      {unreadCount > 0 ? (
        <View style={styles.notificationBadge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? '99+' : unreadCount.toString()}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderProfileHeader = (showTools: boolean) => (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          paddingTop: insets.top + 20,
        },
      ]}
    >
      {activeArtist ? (
        <View style={[styles.artistHeader, !showTools && { marginBottom: 0 }]}>
          <TouchableOpacity onPress={() => router.push('/selecionar-artista')} activeOpacity={0.8}>
            <OptimizedImage
              imageUrl={activeArtist.profile_url || ''}
              style={[styles.headerAvatar, { borderColor: colors.border }]}
              cacheKey={`artist_${activeArtist.id}`}
              fallbackText={activeArtist.name || 'Artista'}
              fallbackIcon="musical-notes"
              fallbackIconSize={24}
              fallbackIconColor={colors.primary}
              showLoadingIndicator={false}
            />
          </TouchableOpacity>
          <View style={styles.headerArtistDetails}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerArtistName, { color: colors.text }]} numberOfLines={2}>
                {activeArtist.name}
              </Text>
              <View style={styles.headerActions}>
                {showTools &&
                hasAccess &&
                ((financeViewMode === 'month' && events.length > 0) ||
                  (financeViewMode === 'year' && yearHasExportableData)) ? (
                  <TouchableOpacity
                    style={styles.notificationButton}
                    onPress={handleExportFinancialReport}
                  >
                    <Ionicons name="share-outline" size={22} color={colors.primary} />
                  </TouchableOpacity>
                ) : null}
                {showTools && financeViewMode === 'month' && hasAccess ? (
                  <TouchableOpacity
                    style={styles.notificationButton}
                    onPress={() => setShowAddModal(true)}
                  >
                    <Ionicons name="add" size={24} color={colors.primary} />
                  </TouchableOpacity>
                ) : null}
                {notificationBtn}
              </View>
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Financeiro</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.noArtistHeaderRow, !showTools && { marginBottom: 0 }]}>
          <Text style={[styles.headerArtistName, { color: colors.text }]}>Financeiro</Text>
          {notificationBtn}
        </View>
      )}
      {showTools ? (
        <View style={[styles.modeToggleRow, { backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.modeTogglePill,
              financeViewMode === 'month' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setFinanceViewMode('month')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={financeViewMode === 'month' ? '#fff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.modeToggleLabel,
                { color: financeViewMode === 'month' ? '#fff' : colors.textSecondary },
              ]}
            >
              Mês
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeTogglePill,
              financeViewMode === 'year' && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              setAnnualSummaryYear(selectedDate.getFullYear());
              setFinanceViewMode('year');
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="albums-outline"
              size={18}
              color={financeViewMode === 'year' ? '#fff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.modeToggleLabel,
                { color: financeViewMode === 'year' ? '#fff' : colors.textSecondary },
              ]}
            >
              Ano
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {showTools ? (
        <View style={[styles.monthNavigation, { backgroundColor: colors.background }]}>
          {financeViewMode === 'month' ? (
            <>
              <TouchableOpacity onPress={() => navigateMonth('prev')} style={styles.navButton}>
                <Ionicons name="chevron-back" size={24} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>
                {months[currentMonth]} {currentYear}
              </Text>
              <TouchableOpacity onPress={() => navigateMonth('next')} style={styles.navButton}>
                <Ionicons name="chevron-forward" size={24} color={colors.primary} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => setAnnualSummaryYear((y) => y - 1)}
                style={styles.navButton}
              >
                <Ionicons name="chevron-back" size={24} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>{annualSummaryYear}</Text>
              <TouchableOpacity
                onPress={() => setAnnualSummaryYear((y) => y + 1)}
                style={styles.navButton}
              >
                <Ionicons name="chevron-forward" size={24} color={colors.primary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}
    </View>
  );

  // Se ainda está verificando acesso, mostrar loading
  if (isCheckingAccess) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderProfileHeader(false)}
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Verificando permissões...</Text>
        </View>
      </View>
    );
  }

  // Se não há artista ativo, mostrar mensagem informativa
  if (!activeArtist) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderProfileHeader(false)}
        <View style={styles.noArtistContainer}>
          <View style={[styles.noArtistCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.noArtistIcon, { backgroundColor: colors.background }]}>
              <Ionicons name="musical-notes" size={60} color={colors.primary} />
            </View>
            
            {hasAnyArtist ? (
              /* Usuário tem artistas mas nenhum selecionado */
              <>
                <Text style={[styles.noArtistTitle, { color: colors.text }]}>
                  Selecione um Artista
                </Text>
                <Text style={[styles.noArtistMessage, { color: colors.textSecondary }]}>
                  Você precisa selecionar um artista para visualizar os dados financeiros.
                </Text>
                <TouchableOpacity
                  style={[styles.createButton, { backgroundColor: colors.primary, marginTop: 20 }]}
                  onPress={() => router.push('/selecionar-artista')}
                >
                  <Ionicons name="list" size={20} color="#fff" />
                  <Text style={styles.createButtonText}>Selecionar Artista</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* Usuário não tem artistas */
              <>
                <Text style={[styles.noArtistTitle, { color: colors.text }]}>
                  Nenhum Artista Selecionado
                </Text>
                <Text style={[styles.noArtistMessage, { color: colors.textSecondary }]}>
                  Para visualizar dados financeiros, você precisa ter um perfil de artista ativo.
                </Text>
                <Text style={[styles.noArtistSubMessage, { color: colors.textSecondary }]}>
                  Após criar seu perfil de artista e começar a adicionar eventos, você poderá acompanhar:
                </Text>
                
                <View style={styles.featuresList}>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Receitas dos seus eventos
                    </Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Controle de despesas
                    </Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Relatórios financeiros
                    </Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Análise de lucratividade
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    );
  }


  // Removido o bloqueio total - viewers podem ver a tela mas sem valores

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderProfileHeader(true)}

      <ScrollView style={[styles.content, { backgroundColor: colors.background }]}>
        {financeViewMode === 'year' ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, paddingHorizontal: 20, marginBottom: 4 }]}>
              Resumo de {annualSummaryYear}
            </Text>
            <Text style={[styles.annualHint, { color: colors.textSecondary }]}>
              Toque em um mês para ver o financeiro daquele mês
            </Text>

            {hasAccess ? (
              <View style={styles.summaryContainer}>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                    Lucro líquido no ano
                  </Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: yearTotals.netProfit >= 0 ? colors.success : colors.error },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {formatCurrency(yearTotals.netProfit)}
                  </Text>
                </View>

                <View style={styles.summaryRow}>
                  <View style={[styles.summaryItem, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.summaryItemLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      Receitas no ano
                    </Text>
                    <Text
                      style={[styles.summaryItemValue, { color: receitaAzul }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {formatCurrency(yearTotals.totalRevenue)}
                    </Text>
                  </View>

                  <View style={[styles.summaryItem, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.summaryItemLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      Despesas no ano
                    </Text>
                    <Text
                      style={[styles.summaryItemValue, { color: colors.error }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {formatCurrency(yearTotals.totalExpenses)}
                    </Text>
                  </View>
                </View>

                <View style={[styles.annualTotalEventsBanner, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.annualTotalEventsLabel, { color: colors.textSecondary }]}>
                    Eventos no ano
                  </Text>
                  <Text style={[styles.annualTotalEventsValue, { color: colors.text }]}>
                    {yearTotals.eventCount}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.summaryContainer}>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Ionicons name="lock-closed" size={32} color={colors.textSecondary} style={{ marginBottom: 8 }} />
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Valores financeiros ocultos
                  </Text>
                  <Text style={[styles.lockedSubtext, { color: colors.textSecondary }]}>
                    Apenas administradores podem visualizar valores. Abaixo, quantidade de eventos por mês.
                  </Text>
                </View>
                <View style={[styles.annualTotalEventsBanner, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.annualTotalEventsLabel, { color: colors.textSecondary }]}>
                    Eventos no ano
                  </Text>
                  <Text style={[styles.annualTotalEventsValue, { color: colors.text }]}>
                    {yearTotals.eventCount}
                  </Text>
                </View>
              </View>
            )}

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                  Carregando resumo do ano...
                </Text>
              </View>
            ) : (
              <View style={[styles.eventsSection, { paddingTop: 4 }]}>
                {yearMonthSummaries.map((row) => {
                  const totalRev = row.revenueFromEvents + row.standaloneIncome;
                  const totalExp = row.eventLinkedExpenses + row.standaloneExpensesPositive;
                  const net = totalRev - totalExp;
                  const hasData = row.eventCount > 0 || totalRev > 0 || totalExp > 0;
                  return (
                    <TouchableOpacity
                      key={row.monthIndex}
                      style={[styles.annualMonthCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={() => goToMonthFromAnnual(row.monthIndex)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.annualMonthCardHeader}>
                        <View style={styles.annualMonthTitleGroup}>
                          <Text style={[styles.annualMonthName, { color: colors.text }]}>
                            {months[row.monthIndex]}
                          </Text>
                          <View
                            style={[
                              styles.annualMonthEventBadge,
                              { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                          >
                            <Text style={[styles.annualMonthEventBadgeText, { color: colors.textSecondary }]}>
                              {row.eventCount} {row.eventCount === 1 ? 'evento' : 'eventos'}
                            </Text>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                      </View>

                      {hasAccess && hasData ? (
                        <View style={[styles.annualMonthNumbersWrap, { borderTopColor: colors.border }]}>
                          <View style={styles.annualMonthNumbers}>
                            <View style={styles.annualMonthNumberCol}>
                              <Text style={[styles.annualMonthNumLabel, { color: colors.textSecondary }]}>
                                Receitas
                              </Text>
                              <Text style={[styles.annualMonthNumValue, { color: receitaAzul }]}>
                                {formatCurrency(totalRev)}
                              </Text>
                            </View>
                            <View style={styles.annualMonthNumberCol}>
                              <Text style={[styles.annualMonthNumLabel, { color: colors.textSecondary }]}>
                                Despesas
                              </Text>
                              <Text style={[styles.annualMonthNumValue, { color: colors.error }]}>
                                {formatCurrency(totalExp)}
                              </Text>
                            </View>
                            <View style={styles.annualMonthNumberCol}>
                              <Text style={[styles.annualMonthNumLabel, { color: colors.textSecondary }]}>
                                Líquido
                              </Text>
                              <Text
                                style={[
                                  styles.annualMonthNumValue,
                                  { color: net >= 0 ? colors.success : colors.error },
                                ]}
                              >
                                {formatCurrency(net)}
                              </Text>
                            </View>
                          </View>
                        </View>
                      ) : !hasData ? (
                        <Text style={[styles.annualMonthEmpty, { color: colors.textSecondary }]}>
                          Sem movimentação neste mês
                        </Text>
                      ) : (
                        <Text style={[styles.annualMonthEmpty, { color: colors.textSecondary }]}>
                          Toque para ver o mês na agenda e no financeiro
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {activeArtist && (
              <View style={styles.goalSection}>
                <TouchableOpacity
                  style={[styles.detailsButton, { backgroundColor: colors.primary + '18' }]}
                  onPress={openFinanceInsights}
                  activeOpacity={0.85}
                >
                  <View style={[styles.detailsButtonIconCircle, { backgroundColor: colors.primary + '28' }]}>
                    <Ionicons name="stats-chart-outline" size={22} color={colors.primary} />
                  </View>
                  <View style={styles.detailsButtonTextWrap}>
                    <Text style={[styles.detailsButtonTitle, { color: colors.text }]}>Ver estatísticas</Text>
                    <Text style={[styles.detailsButtonSub, { color: colors.textSecondary }]}>
                      Rankings de cidades, estados e cachês do ano {annualSummaryYear}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <>
        {/* Resumo financeiro */}
        {hasAccess ? (
          <View style={styles.summaryContainer}>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                Lucro Líquido
              </Text>
              <Text 
                style={[styles.summaryValue, { color: netProfit >= 0 ? colors.success : colors.error }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {formatCurrency(netProfit)}
              </Text>
            </View>
            
            <View style={styles.summaryRow}>
              <View style={[styles.summaryItem, { backgroundColor: colors.surface }]}>
                <Text style={[styles.summaryItemLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  Receita Bruta
                </Text>
                <Text 
                  style={[styles.summaryItemValue, { color: receitaAzul }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatCurrency(totalRevenueWithIncome)}
                </Text>
              </View>
              
              <View style={[styles.summaryItem, { backgroundColor: colors.surface }]}>
                <Text style={[styles.summaryItemLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  Despesas Totais
                </Text>
                <Text 
                  style={[styles.summaryItemValue, { color: colors.error }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatCurrency(totalExpenses)}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.summaryContainer}>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
              <Ionicons name="lock-closed" size={32} color={colors.textSecondary} style={{ marginBottom: 8 }} />
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Valores Financeiros Ocultos</Text>
              <Text style={[styles.lockedSubtext, { color: colors.textSecondary }]}>
                Apenas administradores podem visualizar dados financeiros
              </Text>
            </View>
          </View>
        )}

        {activeArtist && (
          <View style={styles.goalSection}>
            {hasAccess ? (
              <TouchableOpacity
                style={[styles.detailsButton, { backgroundColor: colors.primary + '18' }]}
                onPress={() => void openFinanceDetails()}
                activeOpacity={0.85}
              >
                <View style={[styles.detailsButtonIconCircle, { backgroundColor: colors.primary + '28' }]}>
                  <Ionicons name="analytics-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.detailsButtonTextWrap}>
                  <Text style={[styles.detailsButtonTitle, { color: colors.text }]}>Ver detalhes</Text>
                  <Text style={[styles.detailsButtonSub, { color: colors.textSecondary }]}>
                    Gráficos, legenda e maiores despesas e lucros
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[
                styles.detailsButton,
                { backgroundColor: colors.primary + '18', marginTop: hasAccess ? 10 : 0 },
              ]}
              onPress={openFinanceInsights}
              activeOpacity={0.85}
            >
              <View style={[styles.detailsButtonIconCircle, { backgroundColor: colors.primary + '28' }]}>
                <Ionicons name="stats-chart-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.detailsButtonTextWrap}>
                <Text style={[styles.detailsButtonTitle, { color: colors.text }]}>Ver estatísticas</Text>
                <Text style={[styles.detailsButtonSub, { color: colors.textSecondary }]}>
                  Rankings de cidades, estados e cachês de {months[currentMonth]} de {currentYear}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

            {hasAccess && monthRevenueGoal != null && monthRevenueGoal > 0 ? (
              <View style={[styles.goalCard, { backgroundColor: colors.surface }]}>
                <View style={styles.goalHeaderRow}>
                  <Text style={[styles.goalTitle, { color: colors.text }]}>Meta de receita do mês</Text>
                  <TouchableOpacity onPress={openGoalModal} hitSlop={12}>
                    <Text style={[styles.goalLink, { color: colors.primary }]}>Editar</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.background }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${goalProgress * 100}%`,
                        backgroundColor: goalProgress >= 1 ? colors.success : colors.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.goalStats, { color: colors.textSecondary }]}>
                  {formatCurrency(totalRevenueWithIncome)} de {formatCurrency(monthRevenueGoal)} ({goalPercentLabel}%)
                </Text>
                {goalProgress >= 1 ? (
                  <Text style={[styles.goalCongrats, { color: colors.success }]}>Meta atingida</Text>
                ) : null}
              </View>
            ) : hasAccess ? (
              <TouchableOpacity
                style={[styles.goalCompactRow, { backgroundColor: colors.surface }]}
                onPress={openGoalModal}
                activeOpacity={0.75}
                hitSlop={{ top: 4, bottom: 4 }}
              >
                <Ionicons name="flag-outline" size={17} color={colors.textSecondary} />
                <Text style={[styles.goalCompactLabel, { color: colors.textSecondary }]}>
                  Meta de receita do mês
                </Text>
                <Text style={[styles.goalCompactAction, { color: colors.primary }]}>Definir</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Lista de eventos */}
        <View style={styles.eventsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Eventos de {months[currentMonth]} ({events.length})
          </Text>
          
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Carregando dados financeiros...
              </Text>
            </View>
          ) : events.length > 0 ? (
            <FlatList
              data={events}
              renderItem={renderEvent}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>
                Nenhum evento encontrado para este mês
              </Text>
            </View>
          )}
        </View>

        {/* Receitas Avulsas */}
        {hasAccess && (
          <View style={styles.eventsSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              💵 Receitas Avulsas ({standaloneIncome.length})
            </Text>
            
            {standaloneIncome.length > 0 ? (
              <View style={[styles.standaloneExpensesContainer, Platform.OS !== 'android' && { backgroundColor: colors.surface }]}>
                {standaloneIncome.map((income) => (
                <View key={income.id} style={[styles.standaloneExpenseItem, Platform.OS === 'android' ? { backgroundColor: colors.surface } : { borderBottomColor: colors.border }]}>
                  <View style={styles.standaloneExpenseInfo}>
                    <View style={styles.standaloneExpenseHeader}>
                      <Text style={[styles.standaloneExpenseDescription, { color: colors.text }]}>
                        {income.description}
                      </Text>
                      <Text style={[styles.standaloneExpenseValue, { color: colors.success }]}>
                        {formatCurrency(Math.abs(income.value))}
                      </Text>
                    </View>
                    
                    <View style={styles.standaloneExpenseMeta}>
                      <View style={[styles.categoryBadge, { backgroundColor: colors.success + '20' }]}>
                        <Text style={[styles.categoryText, { color: colors.success }]}>
                          {income.category === 'show' ? '🎤 Show' :
                           income.category === 'cache_extra' ? '💵 Cachê Extra' :
                           income.category === 'streaming' ? '📺 Streaming' :
                           income.category === 'direitos' ? '📄 Direitos' :
                           income.category === 'patrocinio' ? '🎗️ Patrocínio' :
                           '⚙️ Outros'}
                        </Text>
                      </View>
                      <Text style={[styles.standaloneExpenseDate, { color: colors.textSecondary }]}>
                        {income.date ? new Date(income.date).toLocaleDateString('pt-BR') : ''}
                      </Text>
                    </View>
                    
                    {income.notes && (
                      <Text style={[styles.standaloneExpenseNotes, { color: colors.textSecondary }]} numberOfLines={2}>
                        {income.notes}
                      </Text>
                    )}
                  </View>
                  
                  <TouchableOpacity
                    style={styles.deleteExpenseButton}
                    onPress={() => handleDeleteStandaloneExpense(income.id)}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              </View>
            ) : (
              <View style={[styles.emptyExpensesContainer, { backgroundColor: colors.surface }]}>
                <Ionicons name="cash-outline" size={32} color={colors.textSecondary} />
                <Text style={[styles.emptyExpensesText, { color: colors.textSecondary }]}>
                  Nenhuma receita avulsa neste mês
                </Text>
                <Text style={[styles.emptyExpensesHint, { color: colors.textSecondary }]}>
                  Clique no botão + para adicionar
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Despesas Avulsas */}
        {hasAccess && (
          <View style={styles.eventsSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              💸 Despesas Avulsas ({standaloneExpensesOnly.length})
            </Text>
            
            {standaloneExpensesOnly.length > 0 ? (
              <View style={[styles.standaloneExpensesContainer, Platform.OS !== 'android' && { backgroundColor: colors.surface }]}>
                {standaloneExpensesOnly.map((expense) => (
                  <View key={expense.id} style={[styles.standaloneExpenseItem, Platform.OS === 'android' ? { backgroundColor: colors.surface } : { borderBottomColor: colors.border }]}>
                    <View style={styles.standaloneExpenseInfo}>
                      <View style={styles.standaloneExpenseHeader}>
                        <Text style={[styles.standaloneExpenseDescription, { color: colors.text }]}>
                          {expense.description}
                        </Text>
                        <Text style={[styles.standaloneExpenseValue, { color: colors.error }]}>
                          {formatCurrency(expense.value)}
                        </Text>
                      </View>
                      
                      <View style={styles.standaloneExpenseMeta}>
                        <View style={[styles.categoryBadge, { backgroundColor: colors.primary + '20' }]}>
                          <Text style={[styles.categoryText, { color: colors.primary }]}>
                            {expense.category === 'equipamento' ? '🔧 Equipamento' :
                             expense.category === 'manutencao' ? '🛠️ Manutenção' :
                             expense.category === 'transporte' ? '🚗 Transporte' :
                             expense.category === 'software' ? '💻 Software' :
                             expense.category === 'marketing' ? '📢 Marketing' :
                             '⚙️ Outros'}
                          </Text>
                        </View>
                        <Text style={[styles.standaloneExpenseDate, { color: colors.textSecondary }]}>
                          {expense.date ? new Date(expense.date).toLocaleDateString('pt-BR') : ''}
                        </Text>
                      </View>
                      
                      {expense.notes && (
                        <Text style={[styles.standaloneExpenseNotes, { color: colors.textSecondary }]} numberOfLines={2}>
                          {expense.notes}
                        </Text>
                      )}
                    </View>
                    
                    <TouchableOpacity
                      style={styles.deleteExpenseButton}
                      onPress={() => handleDeleteStandaloneExpense(expense.id)}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <View style={[styles.emptyExpensesContainer, { backgroundColor: colors.surface }]}>
                <Ionicons name="wallet-outline" size={32} color={colors.textSecondary} />
                <Text style={[styles.emptyExpensesText, { color: colors.textSecondary }]}>
                  Nenhuma despesa avulsa neste mês
                </Text>
                <Text style={[styles.emptyExpensesHint, { color: colors.textSecondary }]}>
                  Clique no botão + para adicionar
                </Text>
              </View>
            )}
          </View>
        )}
          </>
        )}

      </ScrollView>

      {/* Modal de Seleção: Despesa ou Receita */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddModal(false)}
      >
        <TouchableOpacity 
          style={styles.addModalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddModal(false)}
        >
          <View style={[styles.addModalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.addModalTitle, { color: colors.text }]}>
              O que deseja adicionar?
            </Text>

            <TouchableOpacity
              style={[styles.addModalOption, { borderColor: colors.border }]}
              onPress={() => {
                setShowAddModal(false);
                router.push('/adicionar-despesa');
              }}
            >
              <View style={[styles.addModalIconContainer, { backgroundColor: colors.error + '20' }]}>
                <Ionicons name="remove-circle" size={32} color={colors.error} />
              </View>
              <View style={styles.addModalOptionText}>
                <Text style={[styles.addModalOptionTitle, { color: colors.text }]}>
                  Despesa
                </Text>
                <Text style={[styles.addModalOptionDescription, { color: colors.textSecondary }]}>
                  Gastos gerais, equipamentos, etc.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.addModalOption, { borderColor: colors.border }]}
              onPress={() => {
                setShowAddModal(false);
                router.push('/adicionar-receita');
              }}
            >
              <View style={[styles.addModalIconContainer, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="add-circle" size={32} color={colors.success} />
              </View>
              <View style={styles.addModalOptionText}>
                <Text style={[styles.addModalOptionTitle, { color: colors.text }]}>
                  Receita
                </Text>
                <Text style={[styles.addModalOptionDescription, { color: colors.textSecondary }]}>
                  Ganhos extras, cachês avulsos, etc.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.addModalCancelButton, { backgroundColor: colors.background }]}
              onPress={() => setShowAddModal(false)}
            >
              <Text style={[styles.addModalCancelText, { color: colors.text }]}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal de Permissão */}
      <PermissionModal
        visible={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        title="Acesso Restrito"
        message="Apenas administradores podem visualizar os detalhes e valores financeiros dos eventos. Entre em contato com um administrador para solicitar mais permissões."
        icon="lock-closed"
      />

      <PremiumTrialUpsellModal
        visible={premiumTrialModal.visible}
        onClose={closePremiumTrialModal}
        onSubscribe={() => router.push('/assine-premium')}
        message={premiumTrialModal.message}
        title={premiumTrialModal.title}
      />

      <Modal
        visible={showGoalModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGoalModal(false)}
      >
        <View style={styles.goalModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShowGoalModal(false)}
          />
          <View style={[styles.goalModalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.goalModalTitle, { color: colors.text }]}>Meta de receita</Text>
            <Text style={[styles.goalModalSub, { color: colors.textSecondary }]}>
              Meta de {months[currentMonth]} de {currentYear} (eventos + receitas avulsas). Todos os membros do
              artista veem a mesma meta.
            </Text>
            <TextInput
              style={[
                styles.goalModalInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              value={goalInputText}
              onChangeText={(text) => setGoalInputText(formatCurrencyBRLInput(text))}
              placeholder="R$ 0,00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.goalModalPrimary, { backgroundColor: colors.primary }]}
              onPress={() => void saveGoalFromModal()}
            >
              <Text style={styles.goalModalPrimaryText}>Salvar</Text>
            </TouchableOpacity>
            {monthRevenueGoal != null ? (
              <TouchableOpacity style={styles.goalModalRemove} onPress={() => void removeGoal()}>
                <Text style={[styles.goalModalRemoveText, { color: colors.error }]}>Remover meta</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.goalModalCancel} onPress={() => setShowGoalModal(false)}>
              <Text style={[styles.goalModalCancelText, { color: colors.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de Exportação */}
      <Modal
        visible={showExportModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportModal(false)}
      >
        <View style={styles.exportModalOverlay}>
          <View style={[styles.exportModalContainer, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 20) + 30 }]}>
            {/* Header */}
            <View style={styles.exportModalHeader}>
              <View style={styles.exportModalTitleContainer}>
                <Ionicons name="share-outline" size={24} color={colors.primary} />
                <Text style={[styles.exportModalTitle, { color: colors.text }]}>
                  Exportar Relatório
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowExportModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Info Card */}
            <View style={[styles.exportInfoCard, { backgroundColor: colors.background }]}>
              <View style={styles.exportInfoRow}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={[styles.exportInfoText, { color: colors.text }]}>
                  {financeViewMode === 'year'
                    ? `Ano ${annualSummaryYear} (todos os meses)`
                    : `${months[currentMonth]} de ${currentYear}`}
                </Text>
              </View>
              <View style={styles.exportInfoRow}>
                <Ionicons name="musical-notes-outline" size={18} color={colors.primary} />
                <Text style={[styles.exportInfoText, { color: colors.text }]}>
                  {financeViewMode === 'year'
                    ? `${yearTotals.eventCount} evento${yearTotals.eventCount !== 1 ? 's' : ''} no ano`
                    : `${events.length} evento${events.length !== 1 ? 's' : ''}`}
                </Text>
              </View>
              {activeArtist && (
                <View style={styles.exportInfoRow}>
                  <Ionicons name="person-outline" size={18} color={colors.primary} />
                  <Text style={[styles.exportInfoText, { color: colors.text }]}>
                    {activeArtist.name}
                  </Text>
                </View>
              )}
            </View>

            <ScrollView style={styles.exportModalContent}>
              {/* Seção: Exportar como Documento PDF */}
              <View style={styles.exportSection}>
                <Text style={[styles.exportSectionTitle, { color: colors.text }]}>
                  📄 Exportar como Documento
                </Text>
                
                <TouchableOpacity
                  style={[styles.exportOptionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => generateReport(true)}
                >
                  <View style={[styles.exportOptionIconCircle, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="document-text" size={24} color={colors.primary} />
                  </View>
                  <View style={styles.exportOptionContent}>
                    <Text style={[styles.exportOptionTitle, { color: colors.text }]}>
                      Com Valores Financeiros
                    </Text>
                    <Text style={[styles.exportOptionDescription, { color: colors.textSecondary }]}>
                      {financeViewMode === 'year'
                        ? 'PDF do ano, mês a mês, com receitas, despesas e lucros'
                        : 'PDF completo com receitas, despesas e lucros'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportOptionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => generateReport(false)}
                >
                  <View style={[styles.exportOptionIconCircle, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="eye-off" size={24} color={colors.primary} />
                  </View>
                  <View style={styles.exportOptionContent}>
                    <Text style={[styles.exportOptionTitle, { color: colors.text }]}>
                      Sem Valores Financeiros
                    </Text>
                    <Text style={[styles.exportOptionDescription, { color: colors.textSecondary }]}>
                      {financeViewMode === 'year'
                        ? 'PDF do ano por mês: nomes, datas e cidades (sem valores)'
                        : 'PDF apenas com agenda e locais dos eventos'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Seção: Copiar como Texto */}
              <View style={styles.exportSection}>
                <Text style={[styles.exportSectionTitle, { color: colors.text }]}>
                  📋 Copiar como Texto
                </Text>
                
                <TouchableOpacity
                  style={[styles.exportOptionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => void copyAsText(true)}
                >
                  <View style={[styles.exportOptionIconCircle, { backgroundColor: '#25D366' + '15' }]}>
                    <Ionicons name="copy" size={24} color="#25D366" />
                  </View>
                  <View style={styles.exportOptionContent}>
                    <Text style={[styles.exportOptionTitle, { color: colors.text }]}>
                      Com Valores Financeiros
                    </Text>
                    <Text style={[styles.exportOptionDescription, { color: colors.textSecondary }]}>
                      Texto com receitas, despesas e lucros
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportOptionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => void copyAsText(false)}
                >
                  <View style={[styles.exportOptionIconCircle, { backgroundColor: '#25D366' + '15' }]}>
                    <Ionicons name="list" size={24} color="#25D366" />
                  </View>
                  <View style={styles.exportOptionContent}>
                    <Text style={[styles.exportOptionTitle, { color: colors.text }]}>
                      Sem Valores Financeiros
                    </Text>
                    <Text style={[styles.exportOptionDescription, { color: colors.textSecondary }]}>
                      Texto com agenda e locais dos eventos
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  artistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    borderWidth: 2,
  },
  headerArtistDetails: { flex: 1, minWidth: 0 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerArtistName: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 4 },
  headerSubtitle: { fontSize: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', marginRight: -8 },
  noArtistHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  notificationButton: { position: 'relative', padding: 8 },
  notificationBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  monthNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    padding: 8,
  },
  navButton: {
    padding: 8,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  modeTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  modeToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  annualHint: {
    fontSize: 13,
    paddingHorizontal: 20,
    marginBottom: 12,
    lineHeight: 18,
  },
  annualTotalEventsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: Platform.OS === 'android' ? 16 : 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Platform.OS === 'android' ? 4 : 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  annualTotalEventsLabel: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  annualTotalEventsValue: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  annualMonthCard: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  annualMonthCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 0,
  },
  annualMonthTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    minWidth: 0,
  },
  annualMonthName: {
    fontSize: 17,
    fontWeight: '700',
  },
  annualMonthEventBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  annualMonthEventBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  annualMonthNumbersWrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  annualMonthNumbers: {
    flexDirection: 'row',
    gap: 10,
  },
  annualMonthNumberCol: {
    flex: 1,
  },
  annualMonthNumLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  annualMonthNumValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  annualMonthEmpty: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
  },
  content: {
    flex: 1,
  },
  summaryContainer: {
    padding: 20,
  },
  summaryCard: {
    borderRadius: Platform.OS === 'android' ? 16 : 12,
    padding: Platform.OS === 'android' ? 16 : 20,
    alignItems: 'center',
    marginBottom: Platform.OS === 'android' ? 16 : 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Platform.OS === 'android' ? 4 : 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  summaryLabel: {
    fontSize: 16,
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 15,
  },
  summaryItem: {
    flex: 1,
    borderRadius: Platform.OS === 'android' ? 16 : 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Platform.OS === 'android' ? 4 : 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  summaryItemLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  summaryItemValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  transactionsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  transactionCard: {
    borderRadius: Platform.OS === 'android' ? 16 : 12,
    padding: 16,
    marginBottom: Platform.OS === 'android' ? 16 : 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Platform.OS === 'android' ? 4 : 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  transactionCategory: {
    fontSize: 14,
    color: '#666',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
    color: '#999',
  },
  eventsSection: {
    padding: 20,
  },
  eventCard: {
    borderRadius: Platform.OS === 'android' ? 16 : 12,
    padding: 16,
    marginBottom: Platform.OS === 'android' ? 16 : 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Platform.OS === 'android' ? 4 : 2 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 6,
    overflow: 'hidden',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventInfo: {
    flex: 1,
  },
  eventNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
  },
  eventValues: {
    alignItems: 'flex-end',
    minWidth: 120,
  },
  eventValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventValueLabel: {
    fontSize: 12,
    marginRight: 8,
  },
  eventRevenue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  eventExpenses: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  eventNetRow: {
    borderTopWidth: 1,
    paddingTop: 6,
    marginTop: 4,
    marginBottom: 0,
  },
  eventNetLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  eventNet: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  expensesSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  expensesTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  expenseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 6,
  },
  expenseInfo: {
    flex: 1,
  },
  expenseName: {
    fontSize: 14,
    marginBottom: 2,
  },
  expenseValue: {
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
  noArtistContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  noArtistCard: {
    borderRadius: 16,
    padding: Platform.OS === 'android' ? 16 : 30,
    marginBottom: Platform.OS === 'android' ? 16 : 0,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 8,
    overflow: Platform.OS === 'android' ? 'hidden' : ('visible' as const),
    maxWidth: 400,
    width: '100%',
  },
  noArtistIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  noArtistTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  noArtistMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 16,
  },
  noArtistSubMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  featuresList: {
    width: '100%',
    alignItems: 'flex-start',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    width: '100%',
  },
  featureText: {
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
  },
  noAccessContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  noAccessCard: {
    borderRadius: 16,
    padding: Platform.OS === 'android' ? 16 : 30,
    marginBottom: Platform.OS === 'android' ? 16 : 0,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 8,
    overflow: Platform.OS === 'android' ? 'hidden' : ('visible' as const),
    maxWidth: 400,
    width: '100%',
  },
  noAccessIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  noAccessTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  noAccessMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 16,
  },
  noAccessSubMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  lockedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  lockedText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lockedSubtext: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
  exportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  exportModalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.25,
    shadowRadius: Platform.OS === 'android' ? 0 : 12,
    elevation: Platform.OS === 'android' ? 0 : 10,
  },
  exportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  exportModalTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  exportInfoCard: {
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 12,
    gap: 10,
  },
  exportInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exportInfoText: {
    fontSize: 14,
    fontWeight: '500',
  },
  exportModalContent: {
    paddingHorizontal: 20,
  },
  exportSection: {
    marginTop: 20,
  },
  exportSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  exportOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    gap: 12,
  },
  exportOptionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exportOptionContent: {
    flex: 1,
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  exportOptionDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  standaloneExpensesContainer: {
    marginTop: 12,
    ...(Platform.OS !== 'android' && { borderRadius: 12, padding: 16 }),
  },
  // No Android: mesmo modelo do card de Receitas/Despesas avulsas
  standaloneExpenseItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...(Platform.OS === 'android'
      ? {
          borderRadius: 16,
          marginBottom: 16,
          padding: 16,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0,
          shadowRadius: 0,
          elevation: 0,
          overflow: 'hidden' as const,
        }
      : {
          paddingVertical: 12,
          borderBottomWidth: 1,
        }),
  },
  standaloneExpenseInfo: {
    flex: 1,
    marginRight: 12,
  },
  standaloneExpenseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  standaloneExpenseDescription: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  standaloneExpenseValue: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  standaloneExpenseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  standaloneExpenseDate: {
    fontSize: 12,
  },
  standaloneExpenseNotes: {
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
  deleteExpenseButton: {
    padding: 8,
  },
  emptyExpensesContainer: {
    padding: 32,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyExpensesText: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyExpensesHint: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  addModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  addModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  addModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  addModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  addModalIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addModalOptionText: {
    flex: 1,
  },
  addModalOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  addModalOptionDescription: {
    fontSize: 13,
  },
  addModalCancelButton: {
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  addModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  goalSection: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    gap: 12,
  },
  goalCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 0,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  goalTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  goalLink: {
    fontSize: 15,
    fontWeight: '600',
  },
  progressTrack: {
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 6,
  },
  goalStats: {
    fontSize: 13,
    marginTop: 8,
  },
  goalCongrats: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  goalCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 10,
  },
  goalCompactLabel: {
    flex: 1,
    fontSize: 13,
  },
  goalCompactAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 10,
  },
  detailsButtonIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsButtonTextWrap: {
    flex: 1,
  },
  detailsButtonTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  detailsButtonSub: {
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  goalModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  goalModalCard: {
    borderRadius: 16,
    padding: 20,
  },
  goalModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  goalModalSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  goalModalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    marginBottom: 16,
  },
  goalModalPrimary: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  goalModalPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  goalModalRemove: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  goalModalRemoveText: {
    fontSize: 15,
    fontWeight: '600',
  },
  goalModalCancel: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  goalModalCancelText: {
    fontSize: 15,
  },
});

