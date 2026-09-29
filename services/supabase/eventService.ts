import { supabase } from "../../lib/supabase";
import { cacheService } from "../cacheService";
import { getUserPermissions, hasPermission } from "./permissionsService";

const SUPABASE_URL = "https://ctulmpyaikxsnjqmrzxf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0dWxtcHlhaWt4c25qcW1yenhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2MzkxMjMsImV4cCI6MjA3MzIxNTEyM30.bu0gER4uTIZ5PDV7t1-fcwU01UZAJ6aFG6axFZQlU8U";

/**
 * Envia push (Edge Function send-push) para todos os membros do artista, exceto `excludeUserId`.
 */
export const notifyArtistMembersPush = async (
  artistId: string,
  excludeUserId: string,
  title: string,
  message: string,
  data: Record<string, any> = {},
): Promise<void> => {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        artist_id: artistId,
        creator_user_id: excludeUserId,
        title,
        message,
        data,
      }),
    });

    const json = await response.json();

    if (!response.ok) {
      console.error("⚠️ Erro ao enviar notificações push:", json);
    } else {
      console.log("✅ Notificações push enviadas:", json);
    }
  } catch (error) {
    console.error("⚠️ Erro ao chamar função de notificação:", error);
    // Não falha a operação se o push falhar
  }
};

export interface Event {
  id: string;
  artist_id: string;
  created_by: string;
  updated_by?: string | null;
  name: string;
  description?: string;
  /** Descrição opt-in mostrada para colaboradores viewer (distinta de `description`, interna). */
  viewer_description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  value?: number;
  /** Valor já pago/antecipado. Sem valor (null/0) o app não mostra progresso. */
  paid_amount?: number | null;
  city?: string;
  state_uf?: string | null;
  contractor_phone?: string;
  confirmed: boolean;
  tag: "ensaio" | "evento" | "reunião";
  ativo?: boolean;
  update_ativo?: string | null;
  /** URL pública do arquivo de contrato (Storage) */
  contract_url?: string | null;
  /** Nome original do arquivo anexado */
  contract_file_name?: string | null;
  /** Evento criado ao aceitar convite de participação */
  convite_participacao_id?: string | null;
  /** Anúncio do feed (`disponivel` / `demanda`). NULL = evento normal da agenda. */
  feed_tipo?: "disponivel" | "demanda" | null;
  created_at: string;
  updated_at: string;
}

function excludeFeedMarketplaceEvents<T extends { feed_tipo?: string | null }>(
  events: T[] | null | undefined,
): T[] {
  return (events ?? []).filter((event) => {
    const tipo = event.feed_tipo;
    return tipo == null || String(tipo).trim() === "";
  });
}

export interface EventExpense {
  id: string;
  event_id: string;
  name: string;
  value: number;
  receipt_url?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEventData {
  artist_id: string;
  user_id: string;
  name: string;
  description?: string;
  viewer_description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  value?: number;
  paid_amount?: number | null;
  city?: string;
  state_uf?: string | null;
  contractor_phone?: string;
  confirmed?: boolean;
  tag?: "ensaio" | "evento" | "reunião";
  expenses?: CreateExpenseData[];
  contract_url?: string | null;
  contract_file_name?: string | null;
  convite_participacao_id?: string | null;
}

export interface CreateExpenseData {
  name: string;
  value: number;
  receipt_url?: string;
}

export interface UpdateEventData {
  name?: string;
  description?: string;
  viewer_description?: string | null;
  value?: number;
  paid_amount?: number | null;
  city?: string;
  state_uf?: string | null;
  contractor_phone?: string;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  confirmed?: boolean;
  tag?: "ensaio" | "evento" | "reunião";
  contract_url?: string | null;
  contract_file_name?: string | null;
  updated_by?: string | null;
}

// Criar evento com despesas
export const createEvent = async (
  eventData: CreateEventData,
): Promise<{ success: boolean; error: string | null; event?: Event }> => {
  try {
    console.log("📝 Criando evento:", {
      artist_id: eventData.artist_id,
      user_id: eventData.user_id,
      name: eventData.name,
    });

    // Criar o evento
    const { data: event, error: eventError } = await supabase
      .from("events")
      .insert({
        artist_id: eventData.artist_id,
        created_by: eventData.user_id, // Quem criou o evento
        updated_by: eventData.user_id,
        name: eventData.name,
        description: eventData.description || null,
        viewer_description: eventData.viewer_description || null,
        event_date: eventData.event_date,
        start_time: eventData.start_time,
        end_time: eventData.end_time,
        // Preservar R$ 0,00 (0 é um valor válido; `|| null` convertia 0 em null)
        value: eventData.value ?? null,
        paid_amount: eventData.paid_amount ?? null,
        city: eventData.city || null,
        state_uf:
          eventData.state_uf != null && String(eventData.state_uf).trim()
            ? String(eventData.state_uf).trim().toUpperCase().slice(0, 2)
            : null,
        contractor_phone: eventData.contractor_phone || null,
        confirmed: eventData.confirmed || false,
        tag: eventData.tag || "evento", // Default para 'evento' se não especificado
        contract_url: eventData.contract_url ?? null,
        contract_file_name: eventData.contract_file_name ?? null,
        convite_participacao_id: eventData.convite_participacao_id ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (eventError) {
      console.error("❌ Erro ao criar evento:", eventError);
      return { success: false, error: eventError.message };
    }

    console.log("✅ Evento criado com sucesso:", event.id);

    // O trigger notify_event_created() no banco já cria as notificações
    // automaticamente para todos os colaboradores (exceto o criador)

    // Enviar notificações push para todos os membros do artista (exceto o criador)
    await notifyArtistMembersPush(
      eventData.artist_id,
      eventData.user_id,
      "Novo Evento Criado",
      `${eventData.name} - ${new Date(eventData.event_date).toLocaleDateString("pt-BR")}`,
      {
        screen: "event",
        event_id: event.id,
      },
    );

    // Se há despesas, criar elas
    if (eventData.expenses && eventData.expenses.length > 0) {
      const expensesToInsert = eventData.expenses.map((expense) => ({
        event_id: event.id,
        name: expense.name,
        value: expense.value,
        receipt_url: expense.receipt_url || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: expensesError } = await supabase
        .from("event_expenses")
        .insert(expensesToInsert);

      if (expensesError) {
        // Se der erro nas despesas, deletar o evento criado
        await supabase.from("events").delete().eq("id", event.id);
        return { success: false, error: expensesError.message };
      }
    }

    return { success: true, error: null, event };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

// Buscar eventos do artista (apenas ativos)
export const getEventsByArtist = async (
  artistId: string,
): Promise<{ success: boolean; error: string | null; events?: Event[] }> => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("artist_id", artistId)
      .eq("ativo", true)
      .is("feed_tipo", null)
      .order("event_date", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, events: excludeFeedMarketplaceEvents(data) };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

export type RecentEventSuggestion = {
  name: string;
  value: number | null;
};

const rememberedAgendaEventsByArtist = new Map<string, Array<{ name?: string | null; value?: unknown; created_at?: string; event_date?: string }>>();

export function rememberAgendaEventsForSuggestions(
  artistId: string,
  events: Array<{ name?: string | null; value?: unknown; created_at?: string; event_date?: string }>,
) {
  if (!artistId) return;
  rememberedAgendaEventsByArtist.set(artistId, Array.isArray(events) ? events : []);
}

function toSuggestionValue(rawValue: unknown): number | null {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  if (rawValue == null || rawValue === "") return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueRecentSuggestions(
  rows: Array<{ name?: string | null; value?: unknown; created_at?: string; event_date?: string }>,
  limit: number,
): RecentEventSuggestion[] {
  const sorted = [...rows].sort((a, b) => {
    const aKey = String(a.created_at || a.event_date || "");
    const bKey = String(b.created_at || b.event_date || "");
    return bKey.localeCompare(aKey);
  });
  const seen = new Set<string>();
  const suggestions: RecentEventSuggestion[] = [];
  for (const row of sorted) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      name,
      value: toSuggestionValue(row?.value),
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

/** Últimos nomes de evento do artista (mais recentes primeiro), sem repetir. */
export function getRecentEventNameSuggestionsSync(
  artistId: string,
  limit = 8,
): RecentEventSuggestion[] {
  return uniqueRecentSuggestions(
    rememberedAgendaEventsByArtist.get(artistId) || [],
    limit,
  );
}

export const getRecentEventNameSuggestions = async (
  artistId: string,
  limit = 8,
): Promise<{ suggestions: RecentEventSuggestion[]; error: string | null }> => {
  try {
    const collected: Array<{
      name?: string | null;
      value?: unknown;
      created_at?: string;
      event_date?: string;
    }> = [...(rememberedAgendaEventsByArtist.get(artistId) || [])];

    const now = new Date();
    for (let i = 0; i < 6; i += 1) {
      const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const cached = await cacheService.getEventsData<typeof collected>(
        artistId,
        cursor.getFullYear(),
        cursor.getMonth(),
      );
      if (cached?.length) collected.push(...cached);
    }

    if (collected.length > 0) {
      const fromLocal = uniqueRecentSuggestions(collected, limit);
      if (fromLocal.length > 0) {
        return { suggestions: fromLocal, error: null };
      }
    }

    const byRole = await getEventsByArtistWithRole(artistId);
    if (!byRole.error && byRole.events && byRole.events.length > 0) {
      return {
        suggestions: uniqueRecentSuggestions(byRole.events, limit),
        error: null,
      };
    }

    const { data, error } = await supabase
      .from("events")
      .select("name, value, event_date, created_at, feed_tipo")
      .eq("artist_id", artistId)
      .order("event_date", { ascending: false })
      .limit(80);

    if (error) {
      return { suggestions: uniqueRecentSuggestions(collected, limit), error: error.message };
    }

    return {
      suggestions: uniqueRecentSuggestions(
        [...collected, ...excludeFeedMarketplaceEvents(data || [])],
        limit,
      ),
      error: null,
    };
  } catch {
    return {
      suggestions: uniqueRecentSuggestions(
        rememberedAgendaEventsByArtist.get(artistId) || [],
        limit,
      ),
      error: "Erro de conexão",
    };
  }
};

// Buscar eventos por mês
export const getEventsByMonth = async (
  artistId: string,
  year: number,
  month: number,
): Promise<{ success: boolean; error: string | null; events?: Event[] }> => {
  try {
    const startDate = new Date(year, month, 1).toISOString().split("T")[0];
    const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

    console.log(
      "getEventsByMonth: Buscando eventos para artista:",
      artistId,
      "De:",
      startDate,
      "Até:",
      endDate,
    );

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("artist_id", artistId)
      .eq("ativo", true)
      .is("feed_tipo", null)
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: true });

    console.log("getEventsByMonth: Resultado da query:", { data, error });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, events: excludeFeedMarketplaceEvents(data) };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

/** Eventos ativos do artista entre 1º de jan e 31 de dezem do ano (inclusive). */
export const getEventsByYear = async (
  artistId: string,
  year: number,
): Promise<{ success: boolean; error: string | null; events?: Event[] }> => {
  try {
    const startDate = new Date(year, 0, 1).toISOString().split("T")[0];
    const endDate = new Date(year, 11, 31).toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("artist_id", artistId)
      .eq("ativo", true)
      .is("feed_tipo", null)
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, events: excludeFeedMarketplaceEvents(data) };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

/** Eventos ativos do artista entre `startDate` e `endDate` (inclusive), formato YYYY-MM-DD. */
export const getEventsByDateRange = async (
  artistId: string,
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; error: string | null; events?: Event[] }> => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("artist_id", artistId)
      .eq("ativo", true)
      .is("feed_tipo", null)
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null, events: excludeFeedMarketplaceEvents(data) };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

// Buscar evento por ID (só retorna se ativo = true; evento "deletado" = não encontrado)
export const getEventById = async (
  eventId: string,
): Promise<{ success: boolean; error: string | null; event?: Event }> => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .eq("ativo", true)
      .is("feed_tipo", null)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: "Evento não encontrado" };
    }

    return { success: true, error: null, event: data };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

// Atualizar evento
export const updateEvent = async (
  eventId: string,
  eventData: UpdateEventData,
  userId?: string,
): Promise<{ success: boolean; error: string | null; event?: Event }> => {
  try {
    // Buscar o evento antes de atualizar para obter informações necessárias
    const eventResult = await getEventById(eventId);
    if (!eventResult.success || !eventResult.event) {
      return { success: false, error: "Evento não encontrado" };
    }

    if (eventResult.event.convite_participacao_id) {
      return {
        success: false,
        error:
          "Eventos vindos de convite de participação não podem ser alterados após o aceite.",
      };
    }

    if (!userId) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const permissions = await getUserPermissions(
      userId,
      eventResult.event.artist_id,
    );
    const canEdit =
      permissions?.permissions.canEditEvents ||
      (permissions?.role === "vendedor" &&
        eventResult.event.created_by === userId);
    if (!canEdit) {
      return { success: false, error: "Sem permissão para editar este evento" };
    }

    const { data, error } = await supabase
      .from("events")
      .update({
        ...eventData,
        updated_by: userId ?? eventData.updated_by ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .select()
      .single();

    if (error) {
      if (error.message?.includes("JSON object")) {
        return {
          success: false,
          error:
            "Não foi possível atualizar o evento. Verifique suas permissões ou se o evento existe.",
        };
      }
      return { success: false, error: error.message };
    }

    if (!data) {
      return {
        success: false,
        error:
          "Evento não encontrado ou você não possui permissão para editá-lo.",
      };
    }

    // Enviar notificações push para todos os membros do artista (exceto quem editou)
    if (userId) {
      await notifyArtistMembersPush(
        data.artist_id,
        userId,
        "Evento Atualizado",
        `${data.name} foi atualizado`,
        {
          screen: "event",
          event_id: eventId,
        },
      );
    }

    return { success: true, error: null, event: data };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

// Deletar evento (soft delete: ativo = false, update_ativo = agora)
export const deleteEvent = async (
  eventId: string,
  userId?: string,
): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { data: eventRow, error: fetchError } = await supabase
      .from("events")
      .select("id, name, artist_id, created_by")
      .eq("id", eventId)
      .maybeSingle();

    if (fetchError || !eventRow) {
      return { success: false, error: "Evento não encontrado" };
    }

    const eventName = eventRow.name;
    const artistId = eventRow.artist_id;
    if (!userId) {
      return { success: false, error: "Usuário não autenticado" };
    }

    const permissions = await getUserPermissions(userId, artistId);
    const canDelete =
      permissions?.permissions.canDeleteEvents ||
      (permissions?.role === "vendedor" && eventRow.created_by === userId);
    if (!canDelete) {
      return {
        success: false,
        error: "Sem permissão para deletar este evento",
      };
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from("events")
      .update({
        ativo: false,
        update_ativo: now,
        updated_at: now,
        updated_by: userId ?? null,
      })
      .eq("id", eventId);

    if (error) {
      return { success: false, error: error.message };
    }

    if (userId) {
      await notifyArtistMembersPush(
        artistId,
        userId,
        "Evento Deletado",
        `${eventName} foi deletado`,
        {
          screen: "events",
          event_id: eventId,
        },
      );
    }

    return { success: true, error: null };
  } catch {
    return { success: false, error: "Erro de conexão" };
  }
};

// =====================================================
// FUNÇÕES COM VERIFICAÇÃO DE PERMISSÕES
// =====================================================

// Buscar eventos com verificação de permissões
export const getEventsWithPermissions = async (
  artistId: string,
  userId: string,
): Promise<{ events: Event[] | null; error: string | null }> => {
  try {
    // Verificar se o usuário tem permissão para visualizar eventos
    const canView = await hasPermission(userId, artistId, "canViewEvents");
    if (!canView) {
      return { events: null, error: "Sem permissão para visualizar eventos" };
    }

    // Usar a função do banco que filtra por role
    const { data, error } = await supabase.rpc("get_events_by_role", {
      p_artist_id: artistId,
    });

    if (error) {
      console.error("Erro ao buscar eventos:", error);
      return { events: null, error: error.message };
    }

    return { events: excludeFeedMarketplaceEvents(data as Event[]), error: null };
  } catch (error) {
    console.error("Erro ao buscar eventos:", error);
    return { events: null, error: "Erro ao buscar eventos" };
  }
};

// Criar evento com verificação de permissões
export const createEventWithPermissions = async (
  eventData: CreateEventData,
  userId: string,
): Promise<{ success: boolean; error: string | null; event?: Event }> => {
  try {
    // Verificar se o usuário tem permissão para criar eventos
    const canCreate = await hasPermission(
      userId,
      eventData.artist_id,
      "canCreateEvents",
    );
    if (!canCreate) {
      return { success: false, error: "Sem permissão para criar eventos" };
    }

    return await createEvent(eventData);
  } catch (error) {
    console.error("Erro ao criar evento:", error);
    return { success: false, error: "Erro ao criar evento" };
  }
};

// Atualizar evento com verificação de permissões
export const updateEventWithPermissions = async (
  eventId: string,
  eventData: UpdateEventData,
  userId: string,
): Promise<{ success: boolean; error: string | null }> => {
  try {
    // Primeiro, buscar o evento para obter o artist_id
    const eventResult = await getEventById(eventId);
    if (!eventResult.success || !eventResult.event) {
      return { success: false, error: "Evento não encontrado" };
    }

    // Verificar se o usuário tem permissão para editar eventos
    const permissions = await getUserPermissions(
      userId,
      eventResult.event.artist_id,
    );
    const canEdit =
      permissions?.permissions.canEditEvents ||
      (permissions?.role === "vendedor" &&
        eventResult.event.created_by === userId);
    if (!canEdit) {
      return { success: false, error: "Sem permissão para editar eventos" };
    }

    // Atualizar o evento (passa userId para enviar notificações)
    const result = await updateEvent(eventId, eventData, userId);

    // O trigger notify_event_updated() no banco deve usar NEW.updated_by (não created_by)
    // em from_user_id, senão a notificação aparece como se o criador tivesse editado.

    return result;
  } catch (error) {
    console.error("Erro ao atualizar evento:", error);
    return { success: false, error: "Erro ao atualizar evento" };
  }
};

// Deletar evento com verificação de permissões
export const deleteEventWithPermissions = async (
  eventId: string,
  userId: string,
): Promise<{ success: boolean; error: string | null }> => {
  try {
    // Primeiro, buscar o evento para obter o artist_id
    const eventResult = await getEventById(eventId);
    if (!eventResult.success || !eventResult.event) {
      return { success: false, error: "Evento não encontrado" };
    }

    // Verificar se o usuário tem permissão para deletar eventos
    const permissions = await getUserPermissions(
      userId,
      eventResult.event.artist_id,
    );
    const canDelete =
      permissions?.permissions.canDeleteEvents ||
      (permissions?.role === "vendedor" &&
        eventResult.event.created_by === userId);
    if (!canDelete) {
      return { success: false, error: "Sem permissão para deletar eventos" };
    }

    // Deletar o evento (passa userId para enviar notificações)
    return await deleteEvent(eventId, userId);
  } catch (error) {
    console.error("Erro ao deletar evento:", error);
    return { success: false, error: "Erro ao deletar evento" };
  }
};

// Buscar evento por ID com verificação de permissões
export const getEventByIdWithPermissions = async (
  eventId: string,
  userId: string,
): Promise<{ event: Event | null; error: string | null }> => {
  try {
    // Primeiro, buscar o evento
    const eventResult = await getEventById(eventId);
    if (!eventResult.success || !eventResult.event) {
      return { event: null, error: "Evento não encontrado" };
    }

    // Verificar se o usuário tem permissão para visualizar eventos
    const canView = await hasPermission(
      userId,
      eventResult.event.artist_id,
      "canViewEvents",
    );
    if (!canView) {
      return {
        event: null,
        error: "Sem permissão para visualizar este evento",
      };
    }

    // Verificar se o usuário pode ver valores financeiros
    const canViewFinancials = await hasPermission(
      userId,
      eventResult.event.artist_id,
      "canViewFinancials",
    );

    // Vendedor: vê o valor apenas do evento que ele mesmo criou
    const userPermission = await getUserPermissions(
      userId,
      eventResult.event.artist_id,
    );
    const isOwnEventForVendedor =
      userPermission?.role === "vendedor" &&
      userPermission.permissions.canViewOwnEventValue &&
      eventResult.event.created_by === userId;

    // Se não pode ver finanças (e não é o próprio evento do vendedor), remover o valor
    if (!canViewFinancials && !isOwnEventForVendedor) {
      eventResult.event.value = undefined;
    }

    return { event: eventResult.event, error: null };
  } catch (error) {
    console.error("Erro ao buscar evento:", error);
    return { event: null, error: "Erro ao buscar evento" };
  }
};

// =====================================================
// FUNÇÕES RPC COM FILTRAGEM POR ROLE
// Usam as funções do banco que automaticamente ocultam
// colunas sensíveis (como 'value') para viewers
// =====================================================

export interface EventWithRole {
  id: string;
  artist_id: string;
  created_by: string; // Quem criou o evento
  name: string;
  description?: string;
  viewer_description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  value?: number | null; // NULL para viewer
  city?: string;
  state_uf?: string | null;
  contractor_phone?: string;
  confirmed: boolean;
  tag: "ensaio" | "evento" | "reunião";
  feed_tipo?: "disponivel" | "demanda" | null;
  created_at: string;
  updated_at: string;
  user_role?: string; // Role do usuário atual para este artista
}

// Buscar eventos de um artista com filtragem automática por role
export const getEventsByArtistWithRole = async (
  artistId: string,
): Promise<{
  events: EventWithRole[] | null;
  error: string | null;
  errorCode?: string;
}> => {
  try {
    console.log(
      "🔐 Buscando eventos com filtragem por role para artista:",
      artistId,
    );

    const { data, error } = await supabase.rpc("get_events_by_role", {
      p_artist_id: artistId,
    });

    if (error) {
      console.error("❌ Erro ao buscar eventos com role:", error);
      return {
        events: null,
        error: error.message,
        errorCode: error.code || undefined,
      };
    }

    console.log("✅ Eventos carregados com filtragem:", data?.length || 0);
    return { events: excludeFeedMarketplaceEvents(data as EventWithRole[]), error: null };
  } catch (error: any) {
    console.error("❌ Erro ao buscar eventos com role:", error);
    return {
      events: null,
      error: error?.message || "Erro ao buscar eventos",
      errorCode: error?.code,
    };
  }
};

// Buscar eventos de um mês específico com filtragem por role
export const getEventsByMonthWithRole = async (
  artistId: string,
  year: number,
  month: number,
): Promise<{
  success: boolean;
  error: string | null;
  events?: EventWithRole[];
  errorCode?: string;
}> => {
  try {
    const startDate = new Date(year, month, 1).toISOString().split("T")[0];
    const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

    console.log("🔐 getEventsByMonthWithRole:", {
      artistId,
      year,
      month,
      startDate,
      endDate,
    });

    // Buscar todos os eventos do artista com filtragem por role
    const { events, error, errorCode } =
      await getEventsByArtistWithRole(artistId);

    if (error) {
      return { success: false, error, errorCode };
    }

    // Filtrar por mês no cliente (eventos ativos vêm da RPC get_events_by_role no banco)
    const filteredEvents =
      events?.filter(
        (event) => event.event_date >= startDate && event.event_date <= endDate,
      ) ?? [];

    console.log("✅ Eventos filtrados por mês:", filteredEvents.length);
    return { success: true, error: null, events: filteredEvents };
  } catch (error: any) {
    console.error("❌ Erro ao buscar eventos por mês:", error);
    return {
      success: false,
      error: error?.message || "Erro de conexão",
      errorCode: error?.code,
    };
  }
};

// Buscar um evento específico com filtragem por role
export const getEventByIdWithRole = async (
  eventId: string,
): Promise<{ event: EventWithRole | null; error: string | null }> => {
  try {
    console.log("🔐 Buscando evento por ID com role:", eventId);

    const { data, error } = await supabase.rpc("get_event_by_id_with_role", {
      p_event_id: eventId,
    });

    if (error) {
      console.error("❌ Erro ao buscar evento:", error);
      return { event: null, error: error.message };
    }

    console.log("✅ Evento carregado:", data?.[0]);
    return { event: data?.[0] || null, error: null };
  } catch (error) {
    console.error("❌ Erro ao buscar evento:", error);
    return { event: null, error: "Erro ao buscar evento" };
  }
};
