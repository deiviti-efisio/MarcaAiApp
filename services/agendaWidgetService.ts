import { Platform } from "react-native";
import { todayCalendarYmd, toCalendarYmd } from "../lib/dateUtils";

const APP_GROUP = "group.com.marcaai.app";
const SNAPSHOT_KEY = "agendaWidget";

export type AgendaWidgetEvent = {
  event_date?: string | null;
  name?: string | null;
  start_time?: string | null;
  city?: string | null;
  state_uf?: string | null;
};

export type AgendaWidgetSnapshot = {
  artistName: string;
  dates: string[];
  nextName: string | null;
  nextYmd: string | null;
  nextTime: string | null;
  nextPlace: string | null;
};

let storedArtistName = "";

export function setAgendaWidgetArtistName(name: string | null | undefined) {
  storedArtistName = String(name || "").trim();
}

export function buildAgendaWidgetSnapshot(
  events: AgendaWidgetEvent[],
  artistName = storedArtistName,
): AgendaWidgetSnapshot {
  const today = todayCalendarYmd();
  const upcoming = events
    .map((event) => ({
      ymd: toCalendarYmd(event.event_date),
      name: String(event.name || "Show").trim() || "Show",
      time: String(event.start_time || "").slice(0, 5),
      place: [event.city, event.state_uf].filter(Boolean).join("/"),
    }))
    .filter((event) => event.ymd.length === 10 && event.ymd >= today)
    .sort((a, b) => a.ymd.localeCompare(b.ymd) || a.time.localeCompare(b.time));

  const dates = Array.from(
    new Set(
      events
        .map((event) => toCalendarYmd(event.event_date))
        .filter((day) => day.length === 10),
    ),
  );

  const next = upcoming[0];
  return {
    artistName: artistName || storedArtistName,
    dates,
    nextName: next?.name ?? null,
    nextYmd: next?.ymd ?? null,
    nextTime: next?.time || null,
    nextPlace: next?.place || null,
  };
}

export function publishAgendaWidget(
  events: AgendaWidgetEvent[],
  artistName?: string,
) {
  const snapshot = buildAgendaWidgetSnapshot(events, artistName);
  const json = JSON.stringify(snapshot);
  void writeSnapshot(json);
}

export function clearAgendaWidget() {
  storedArtistName = "";
  const empty = buildAgendaWidgetSnapshot([]);
  void writeSnapshot(JSON.stringify(empty));
}

export async function refreshAgendaWidget(artistId: string | null | undefined) {
  if (!artistId) {
    clearAgendaWidget();
    return;
  }
  try {
    const { getEventsByArtistWithRole } = await import(
      "./supabase/eventService"
    );
    const { events, aborted } = await getEventsByArtistWithRole(artistId);
    if (aborted || !events) return;
    publishAgendaWidget(events);
  } catch {
    /* widget é auxiliar */
  }
}

async function writeSnapshot(json: string) {
  try {
    if (Platform.OS === "ios") {
      const { ExtensionStorage } = await import("@bacons/apple-targets");
      const storage = new ExtensionStorage(APP_GROUP);
      storage.set(SNAPSHOT_KEY, json);
      ExtensionStorage.reloadWidget("AgendaWidget");
      return;
    }
    if (Platform.OS === "android") {
      const { requireNativeModule } = await import("expo-modules-core");
      const native = requireNativeModule("AgendaWidget") as {
        saveSnapshot: (value: string) => void;
      };
      native.saveSnapshot(json);
    }
  } catch {
    /* nativo ainda não gerado neste build */
  }
}
