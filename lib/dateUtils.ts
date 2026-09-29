/**
 * Data de calendário no padrão DD/MM/AAAA (ex.: 01/03/2026).
 * Aceita "YYYY-MM-DD" ou ISO com hora; usa só a parte da data, sem conversão de fuso.
 */
export function formatCalendarDate(dateString: string | null | undefined): string {
  if (dateString == null || !String(dateString).trim()) return '';
  const part = String(dateString).trim().split('T')[0];
  const bits = part.split('-');
  if (bits.length < 3) return String(dateString).trim();
  const y = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  const d = parseInt(bits[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return String(dateString).trim();
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d)}/${pad(m)}/${y}`;
}

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Data por extenso (ex.: 19 de setembro de 2026). */
export function formatCalendarDateLong(dateString: string | null | undefined): string {
  const parts = formatCalendarDateLongParts(dateString);
  if (!parts) return dateString == null ? '' : String(dateString).trim();
  return `${parts.day} ${parts.rest}`;
}

export function formatCalendarDateLongParts(
  dateString: string | null | undefined
): { day: string; rest: string } | null {
  if (dateString == null || !String(dateString).trim()) return null;
  const part = String(dateString).trim().split('T')[0];
  const bits = part.split('-');
  if (bits.length < 3) return null;
  const y = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  const d = parseInt(bits[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) {
    return null;
  }
  return { day: String(d), rest: `de ${MONTHS_PT[m - 1]} de ${y}` };
}

const WEEKDAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Dia da semana a partir de "YYYY-MM-DD", sem conversão de fuso. */
export function weekdayFromCalendarDate(dateString: string | null | undefined): string {
  if (dateString == null || !String(dateString).trim()) return '';
  const part = String(dateString).trim().split('T')[0];
  const bits = part.split('-');
  if (bits.length < 3) return '';
  const y = parseInt(bits[0], 10);
  const m = parseInt(bits[1], 10);
  const d = parseInt(bits[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return WEEKDAYS_PT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * Formata uma data ISO (UTC) para horário de Brasília (UTC-3).
 * Útil em React Native onde Intl timeZone pode não ser suportado.
 */
export function formatDateBrazil(dateString: string): string {
  const raw = dateString.trim();
  const hasTimezone = raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw);
  const date = new Date(hasTimezone ? raw : raw + 'Z');

  const utcMs = date.getTime();
  const brazilOffsetMs = -3 * 60 * 60 * 1000; // UTC-3
  const brazilDate = new Date(utcMs + brazilOffsetMs);

  const d = brazilDate.getUTCDate();
  const m = brazilDate.getUTCMonth() + 1;
  const y = brazilDate.getUTCFullYear();
  const h = brazilDate.getUTCHours();
  const min = brazilDate.getUTCMinutes();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d)}/${pad(m)}/${y} ${pad(h)}:${pad(min)}`;
}

/** True se a data do evento (calendário local) já passou (a partir do dia seguinte). */
export function isEventDateAlreadyPast(eventDateIso: string | null | undefined): boolean {
  if (!eventDateIso) return false;
  const part = String(eventDateIso).trim().split('T')[0];
  const [y, m, d] = part.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const eventDate = new Date(y, m - 1, d);
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return todayOnly > eventDate;
}
