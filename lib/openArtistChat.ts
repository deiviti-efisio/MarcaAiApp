import { router } from 'expo-router';
import { Alert } from 'react-native';

export type ShowChatContext = {
  nome?: string | null;
  data?: string | null;
  horario?: string | null;
  local?: string | null;
  funcao?: string | null;
  cache?: string | null;
};

export function buildShowChatMessage(ctx?: ShowChatContext | null): string {
  if (!ctx) return '';
  const parts: string[] = [];
  const nome = ctx.nome?.trim();
  if (nome) parts.push(nome);
  const when = [ctx.data?.trim(), ctx.horario?.trim()].filter(Boolean).join(' · ');
  if (when) parts.push(when);
  const local = ctx.local?.trim();
  if (local && local.toLowerCase() !== 'não informado') parts.push(local);
  const funcao = ctx.funcao?.trim();
  if (funcao && funcao.toLowerCase() !== 'interesse') parts.push(funcao);
  const cache = ctx.cache?.trim();
  if (cache) parts.push(cache);
  return parts.join(' · ');
}

export function decodeShowContextParam(raw: unknown): string {
  if (raw == null) return '';
  const joined = Array.isArray(raw) ? raw.filter(Boolean).join(' · ') : String(raw);
  return joined.replace(/\\n/g, ' · ').trim();
}

const SHOW_OPEN = '#show#\n';
const SHOW_CLOSE = '\n#msg#\n';

export function packQuotedChatMessage(quote: string, text: string): string {
  const t = text.trim();
  const q = quote.trim().replace(/\s*\n+\s*/g, ' · ');
  if (!q) return t.slice(0, 2000);
  const packed = `${SHOW_OPEN}${q}${SHOW_CLOSE}${t}`;
  if (packed.length <= 2000) return packed;
  const room = 2000 - SHOW_OPEN.length - SHOW_CLOSE.length - t.length;
  if (room < 8) return t.slice(0, 2000);
  return `${SHOW_OPEN}${q.slice(0, room)}${SHOW_CLOSE}${t}`;
}

export function parseQuotedChatMessage(body: string | null | undefined): {
  quote: string | null;
  text: string;
} {
  const raw = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { quote: null, text: '' };

  if (raw.startsWith('#show#')) {
    const closeIdx = raw.indexOf('\n#msg#\n');
    if (closeIdx !== -1) {
      const quote = raw.slice(SHOW_OPEN.length, closeIdx).trim();
      const text = raw.slice(closeIdx + SHOW_CLOSE.length).trim();
      return { quote: quote || null, text };
    }
  }

  if (raw.startsWith('«show»')) {
    const closeIdx = raw.indexOf('\n«»\n');
    if (closeIdx !== -1) {
      const quote = raw.slice('«show»\n'.length, closeIdx).trim();
      const text = raw.slice(closeIdx + '\n«»\n'.length).trim();
      return { quote: quote || null, text };
    }
  }

  return { quote: null, text: raw };
}

export function formatChatCache(value?: number | null): string | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function openArtistChatInApp(opts: {
  myArtistId?: string | null;
  isAdmin: boolean;
  otherArtistId?: string | null;
  otherArtistName?: string | null;
  otherArtistImage?: string | null;
  showContext?: ShowChatContext | string | null;
}) {
  if (!opts.isAdmin) {
    Alert.alert('Conversa', 'Somente o administrador pode conversar com outros artistas.');
    return;
  }
  if (!opts.myArtistId) {
    Alert.alert('Conversa', 'Selecione um artista para iniciar o bate-papo.');
    return;
  }
  const otherId = (opts.otherArtistId || '').trim();
  if (!otherId || otherId === opts.myArtistId) return;
  const showContext =
    typeof opts.showContext === 'string'
      ? opts.showContext.trim()
      : buildShowChatMessage(opts.showContext);
  router.push({
    pathname: '/conversa',
    params: {
      artistId: otherId,
      artistName: opts.otherArtistName || '',
      artistImage: opts.otherArtistImage || '',
      ...(showContext ? { showContext } : {}),
    },
  });
}
