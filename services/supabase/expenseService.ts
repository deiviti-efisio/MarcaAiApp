import { isAbortError } from '../../lib/abortError';
import { supabase } from '../../lib/supabase';

export interface Expense {
  id: string;
  event_id: string | null; // Nullable para despesas avulsas
  artist_id?: string;
  name?: string;
  description?: string;
  value: number;
  category?: string;
  date?: string;
  notes?: string;
  receipt_url?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateExpenseData {
  name: string;
  value: number;
  receipt_url?: string;
}

export interface UpdateExpenseData {
  name?: string;
  value?: number;
  receipt_url?: string;
}

// Interface para despesas avulsas (sem evento)
export interface CreateStandaloneExpenseData {
  artist_id: string;
  description: string;
  value: number;
  category: string;
  date: string;
  notes?: string;
  event_id?: null; // Explicitamente null
}

// Criar despesa
export const createExpense = async (eventId: string, expenseData: CreateExpenseData): Promise<{ success: boolean; error: string | null; expense?: Expense }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .insert({
        event_id: eventId,
        name: expenseData.name,
        value: expenseData.value,
        receipt_url: expenseData.receipt_url || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expense: data };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Buscar despesas do evento
export const getExpensesByEvent = async (eventId: string): Promise<{ success: boolean; error: string | null; expenses?: Expense[] }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expenses: data || [] };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Buscar despesa por ID
export const getExpenseById = async (expenseId: string): Promise<{ success: boolean; error: string | null; expense?: Expense }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .select('*')
      .eq('id', expenseId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expense: data };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Atualizar despesa
export const updateExpense = async (expenseId: string, expenseData: UpdateExpenseData): Promise<{ success: boolean; error: string | null; expense?: Expense }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .update({
        ...expenseData,
        updated_at: new Date().toISOString()
      })
      .eq('id', expenseId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expense: data };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Deletar despesa
export const deleteExpense = async (expenseId: string): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { error } = await supabase
      .from('event_expenses')
      .delete()
      .eq('id', expenseId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Calcular total de despesas do evento
export const getTotalExpensesByEvent = async (eventId: string): Promise<{ success: boolean; error: string | null; total?: number }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .select('value')
      .eq('event_id', eventId);

    if (error) {
      return { success: false, error: error.message };
    }

    const total = data?.reduce((sum, expense) => sum + expense.value, 0) || 0;
    return { success: true, error: null, total };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// ========== DESPESAS AVULSAS (SEM EVENTO) ==========

// Criar despesa avulsa (sem evento)
export const createStandaloneExpense = async (expenseData: CreateStandaloneExpenseData): Promise<{ success: boolean; error: string | null; expense?: Expense }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .insert({
        artist_id: expenseData.artist_id,
        event_id: null, // Explicitamente null para despesas avulsas
        description: expenseData.description,
        value: expenseData.value,
        category: expenseData.category,
        date: expenseData.date,
        notes: expenseData.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expense: data };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};

// Buscar despesas avulsas de um artista (sem evento)
export const getStandaloneExpensesByArtist = async (
  artistId: string,
  month?: number,
  year?: number,
  abortSignal?: AbortSignal
): Promise<{ success: boolean; error: string | null; expenses?: Expense[]; aborted?: boolean }> => {
  try {
    let query = supabase
      .from('event_expenses')
      .select('*')
      .eq('artist_id', artistId)
      .is('event_id', null); // Apenas despesas sem evento

    if (month !== undefined && year !== undefined) {
      const startDate = new Date(year, month, 1).toISOString().split('T')[0];
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
      query = query.gte('date', startDate).lte('date', endDate);
    }
    query = query.order('date', { ascending: false });
    if (abortSignal) query = query.abortSignal(abortSignal);
    const { data, error } = await query;

    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expenses: data || [] };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    return { success: false, error: 'Erro de conexão' };
  }
};

/** Despesas e receitas avulsas (sem evento) em todo o ano civil informado. */
export const getStandaloneExpensesByArtistYear = async (
  artistId: string,
  year: number,
  abortSignal?: AbortSignal
): Promise<{ success: boolean; error: string | null; expenses?: Expense[]; aborted?: boolean }> => {
  try {
    const startDate = new Date(year, 0, 1).toISOString().split('T')[0];
    const endDate = new Date(year, 11, 31).toISOString().split('T')[0];

    let query = supabase
      .from('event_expenses')
      .select('*')
      .eq('artist_id', artistId)
      .is('event_id', null)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });
    if (abortSignal) query = query.abortSignal(abortSignal);
    const { data, error } = await query;

    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expenses: data || [] };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    return { success: false, error: 'Erro de conexão' };
  }
};

/** Despesas e receitas avulsas entre `startDate` e `endDate` (YYYY-MM-DD, inclusive). */
export const getStandaloneExpensesByArtistDateRange = async (
  artistId: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; error: string | null; expenses?: Expense[] }> => {
  try {
    const { data, error } = await supabase
      .from('event_expenses')
      .select('*')
      .eq('artist_id', artistId)
      .is('event_id', null)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, expenses: data || [] };
  } catch {
    return { success: false, error: 'Erro de conexão' };
  }
};

const EXPENSE_IN_CHUNK = 90;

/** Soma dos valores de despesas vinculadas a eventos, por `event_id`. */
export const getExpenseTotalsByEventIds = async (
  eventIds: string[],
  abortSignal?: AbortSignal
): Promise<{ success: boolean; error: string | null; totalsByEventId?: Record<string, number>; aborted?: boolean }> => {
  try {
    const unique = [...new Set(eventIds.filter(Boolean))];
    const totalsByEventId: Record<string, number> = {};

    if (unique.length === 0) {
      return { success: true, error: null, totalsByEventId };
    }

    for (let i = 0; i < unique.length; i += EXPENSE_IN_CHUNK) {
      if (abortSignal?.aborted) {
        return { success: false, error: null, aborted: true };
      }
      const chunk = unique.slice(i, i + EXPENSE_IN_CHUNK);
      let query = supabase
        .from('event_expenses')
        .select('event_id, value')
        .in('event_id', chunk);
      if (abortSignal) query = query.abortSignal(abortSignal);
      const { data, error } = await query;

      if (abortSignal?.aborted || isAbortError(error)) {
        return { success: false, error: null, aborted: true };
      }
      if (error) {
        return { success: false, error: error.message };
      }

      for (const row of data || []) {
        const eid = row.event_id as string | null;
        if (!eid) continue;
        const v = typeof row.value === 'number' ? row.value : 0;
        totalsByEventId[eid] = (totalsByEventId[eid] || 0) + v;
      }
    }

    return { success: true, error: null, totalsByEventId };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    return { success: false, error: 'Erro de conexão' };
  }
};

/** Todas as despesas vinculadas a eventos, agrupadas por `event_id` (para relatórios em lote). */
export const getExpensesGroupedByEventIds = async (
  eventIds: string[],
  abortSignal?: AbortSignal
): Promise<{ success: boolean; error: string | null; byEventId?: Record<string, Expense[]>; aborted?: boolean }> => {
  try {
    const unique = [...new Set(eventIds.filter(Boolean))];
    const byEventId: Record<string, Expense[]> = {};

    if (unique.length === 0) {
      return { success: true, error: null, byEventId };
    }

    for (let i = 0; i < unique.length; i += EXPENSE_IN_CHUNK) {
      if (abortSignal?.aborted) {
        return { success: false, error: null, aborted: true };
      }
      const chunk = unique.slice(i, i + EXPENSE_IN_CHUNK);
      let query = supabase
        .from('event_expenses')
        .select('*')
        .in('event_id', chunk)
        .order('created_at', { ascending: false });
      if (abortSignal) query = query.abortSignal(abortSignal);
      const { data, error } = await query;

      if (abortSignal?.aborted || isAbortError(error)) {
        return { success: false, error: null, aborted: true };
      }
      if (error) {
        return { success: false, error: error.message };
      }

      for (const row of data || []) {
        const eid = row.event_id as string | null;
        if (!eid) continue;
        if (!byEventId[eid]) byEventId[eid] = [];
        byEventId[eid].push(row as Expense);
      }
    }

    return { success: true, error: null, byEventId };
  } catch (error) {
    if (abortSignal?.aborted || isAbortError(error)) {
      return { success: false, error: null, aborted: true };
    }
    return { success: false, error: 'Erro de conexão' };
  }
};

// Deletar despesa avulsa
export const deleteStandaloneExpense = async (expenseId: string): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { error } = await supabase
      .from('event_expenses')
      .delete()
      .eq('id', expenseId)
      .is('event_id', null); // Apenas despesas sem evento

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: 'Erro de conexão' };
  }
};