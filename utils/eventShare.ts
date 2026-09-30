import { Alert, Share } from 'react-native';

export type EventSharePayload = {
  name?: string | null;
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  city?: string | null;
  description?: string | null;
  contractor_phone?: string | null;
  confirmed?: boolean | null;
  value?: number | string | null;
  tag?: string | null;
};

export function formatEventValueBRL(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (Number.isNaN(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toHHMM(t: unknown): string {
  if (!t) return '';
  if (typeof t === 'string') return t.slice(0, 5);
  return String(t).slice(0, 5);
}

function hasDefinedTime(start: unknown, end: unknown): boolean {
  const s = toHHMM(start) || '00:00';
  const e = toHHMM(end) || '00:00';
  return !(s === '00:00' && e === '00:00');
}

function formatDisplayDate(dateString: string | null): string {
  if (!dateString) return '';
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function buildEventShareMessage(
  item: EventSharePayload,
  includeValue: boolean,
  artistDisplayName: string | null | undefined,
  hasFinancialAccess: boolean
): string {
  const lines: string[] = [];
  lines.push('*DETALHES DO EVENTO*');
  lines.push('');

  if (nonEmptyString(artistDisplayName)) {
    const name = artistDisplayName.trim();
    lines.push(`Artista: *${name}*`);
  }

  const eventTitle = nonEmptyString(item?.name) ? item.name.trim() : 'Evento';
  lines.push(`Evento: ${eventTitle}`);

  if (nonEmptyString(item?.tag)) {
    lines.push(`Tipo: ${item.tag}`);
  }

  if (nonEmptyString(item?.event_date)) {
    const formatted = formatDisplayDate(item.event_date);
    if (formatted) {
      lines.push(`Data: ${formatted}`);
    }
  }

  if (hasDefinedTime(item?.start_time, item?.end_time)) {
    const start = toHHMM(item.start_time);
    const end = toHHMM(item.end_time);
    const timeLine = end && end !== start ? `${start} – ${end}` : start;
    if (nonEmptyString(timeLine)) {
      lines.push(`Horário: ${timeLine}`);
    }
  }

  if (nonEmptyString(item?.city)) {
    lines.push(`Local: ${item.city.trim()}`);
  }

  if (nonEmptyString(item?.description)) {
    lines.push(`Descrição: ${item.description.trim()}`);
  }

  if (nonEmptyString(item?.contractor_phone)) {
    lines.push(`Telefone: ${item.contractor_phone.trim()}`);
  }

  if (typeof item?.confirmed === 'boolean') {
    lines.push(item.confirmed ? 'Status: Confirmado' : 'Status: A confirmar');
  }

  if (
    includeValue &&
    hasFinancialAccess &&
    item?.value !== null &&
    item?.value !== undefined &&
    item?.value !== ''
  ) {
    const n = typeof item.value === 'string' ? parseFloat(item.value) : Number(item.value);
    if (!Number.isNaN(n)) {
      lines.push(`Cachê: ${formatEventValueBRL(item.value)}`);
    }
  }

  lines.push('');
  lines.push('MeuShow');
  return lines.join('\n');
}

export function promptAndShareEvent(
  item: EventSharePayload,
  options: { hasFinancialAccess: boolean; artistDisplayName?: string | null }
): void {
  const runShare = (includeValue: boolean) => {
    const message = buildEventShareMessage(
      item,
      includeValue,
      options.artistDisplayName,
      options.hasFinancialAccess
    );
    Share.share({ message }).catch(() => undefined);
  };

  if (!options.hasFinancialAccess) {
    Alert.alert(
      'Compartilhar evento',
      'Seu perfil não inclui valores financeiros. O texto será enviado sem cachê.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Compartilhar', onPress: () => runShare(false) },
      ]
    );
    return;
  }

  Alert.alert('Compartilhar evento', 'Deseja incluir o valor do cachê no texto?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sem valor', onPress: () => runShare(false) },
    { text: 'Com valor', onPress: () => runShare(true) },
  ]);
}
