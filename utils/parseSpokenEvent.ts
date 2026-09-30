import { BRAZIL_STATES } from "../lib/brazilGeo";

export type SpokenEventTag = "ensaio" | "evento" | "reunião";

export type SpokenExpense = {
  nome: string;
  valor: number;
};

export type SpokenFieldKey =
  | "nome"
  | "valor"
  | "valorPago"
  | "cidade"
  | "data"
  | "horario"
  | "tag"
  | "status"
  | "despesas"
  | "telefone"
  | "estadoUf"
  | "descricao";

export type SpokenEventDraft = {
  transcript: string;
  nome: string;
  valor?: number;
  valorPago?: number;
  cidade?: string;
  /** YYYY-MM-DD no fuso local */
  dataISO: string;
  dateMentioned: boolean;
  startHHmm?: string;
  endHHmm?: string;
  tag: SpokenEventTag;
  confirmed: boolean;
  despesas: SpokenExpense[];
  estadoUf?: string;
  telefone?: string;
  descricao?: string;
  /** Se existir, só esses campos substituem o que já está no formulário. */
  replaceFields?: SpokenFieldKey[];
};

const MONTHS: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

const SMALL: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  trezentos: 300,
  quatrocentos: 400,
  quinhentos: 500,
  seiscentos: 600,
  setecentos: 700,
  oitocentos: 800,
  novecentos: 900,
};

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateFromParts(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function parseWordNumber(phrase: string): number | null {
  const tokens = fold(phrase)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t !== "e" && t !== "reais" && t !== "real");
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let used = false;
  for (const t of tokens) {
    if (t === "mil") {
      current = (current || 1) * 1000;
      total += current;
      current = 0;
      used = true;
      continue;
    }
    const n = SMALL[t];
    if (n == null) {
      if (used) break;
      return null;
    }
    if (n >= 100) {
      current = (current || 1) * n;
    } else {
      current += n;
    }
    used = true;
  }
  total += current;
  return used && total > 0 ? total : null;
}

function titleCasePt(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function consumeMoneyAtStart(s: string): { value: number; rest: string } | null {
  const t = s.replace(/^\s+/, "");
  const digit = t.match(/^(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?/);
  if (digit) {
    const parsed = parseDigitsMoney(digit[0].replace(/r\$/i, "").trim());
    if (parsed != null) {
      const rest = t.slice(digit[0].length).replace(/^\s*reais?\b/, "");
      return { value: parsed, rest };
    }
  }
  const words = t.match(
    /^((?:um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|e|\s)+)/i,
  );
  if (words) {
    const n = parseWordNumber(words[1]);
    if (n != null) {
      const rest = t.slice(words[0].length).replace(/^\s*reais?\b/, "");
      return { value: n, rest };
    }
  }
  return null;
}

const MONEY_LOOKAHEAD =
  "valor|r\\$|\\d|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil";

function parseExpenses(folded: string): { items: SpokenExpense[]; without: string } {
  const marker = folded.search(/\bdespesas?\b/);
  if (marker < 0) return { items: [], without: folded };

  const before = folded.slice(0, marker).trim();
  let rest = folded.slice(marker).replace(/^\s*despesas?\s*/i, "");
  rest = rest.replace(/^\s*de\s+/, "");
  const items: SpokenExpense[] = [];
  const nameRe = new RegExp(
    `^(?:e\\s+)?(?:despesas?\\s+)?(?:de\\s+)?([a-z][a-z ]{0,28}?)\\s+(?:valor\\s+(?:de\\s+)?)?(?=\\s*(?:${MONEY_LOOKAHEAD}))`,
    "i",
  );

  while (rest.trim()) {
    const trimmed = rest.trim();
    const nameMatch = trimmed.match(nameRe);
    if (!nameMatch) break;
    const nomeRaw = nameMatch[1].trim().replace(/\s+/g, " ");
    const afterName = trimmed.slice(nameMatch[0].length).replace(/^\s*(?:valor\s+(?:de\s+)?)?/, "");
    const money = consumeMoneyAtStart(afterName);
    if (!money || nomeRaw.length < 2) break;
    if (
      /^(whatsapp|zap|telefone|fone|contato|celular|em|as|ate|cidade|estado|confirmado|ensaio)$/.test(
        nomeRaw,
      )
    ) {
      break;
    }
    if (money.value > 500_000) break;
    items.push({ nome: titleCasePt(nomeRaw), valor: money.value });
    rest = money.rest.replace(/^\s*[,;]+\s*/, "");
  }

  const without = `${before} ${rest}`.replace(/\s+/g, " ").trim();
  return { items, without };
}

function parseDigitsMoney(raw: string): number | null {
  const compact = raw.replace(/\s/g, "");
  const m = compact.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/);
  if (!m) return null;
  const intPart = m[1].replace(/\./g, "");
  const frac = m[2] ? m[2].padEnd(2, "0").slice(0, 2) : "00";
  const value = Number(intPart) + Number(frac) / 100;
  return Number.isFinite(value) ? value : null;
}

const PAID_KEYWORDS =
  /\b(?:valor\s+(?:ja\s+)?(?:pago|antecipado|adiantado)|(?:ja\s+)?(?:foi\s+)?pago(?:\s+antecipado)?|pagaram|receberam|ja\s+recebi|recebi|adiantamento|adiantado|antecipado|sinal(?:\s+de)?|entrada(?:\s+de)?)\b\s*(?:de\s+|e\s+|eh\s+|é\s+)?/;

const EVENT_VALUE_KEYWORDS =
  /\b(?:valor(?!\s+(?:pago|antecipado|adiantado))|cache|preco|preço)\b\s*(?:de\s+|e\s+|eh\s+|é\s+)?/;

function extractMoneyAndStrip(
  folded: string,
  keywords: RegExp,
): { value?: number; without: string } {
  const km = folded.match(keywords);
  if (!km || km.index == null) return { without: folded };
  const after = folded.slice(km.index + km[0].length);
  const money = consumeMoneyAtStart(after);
  if (!money) return { without: folded };
  const consumed = after.length - money.rest.length;
  const without = `${folded.slice(0, km.index)} ${folded.slice(km.index + km[0].length + consumed)}`
    .replace(/\s+/g, " ")
    .trim();
  return { value: money.value, without };
}

function parseDate(folded: string, fallback: Date): { date: Date; mentioned: boolean } {
  if (/\bhoje\b/.test(folded)) return { date: fallback, mentioned: true };
  if (/\bdepois de amanha\b/.test(folded)) {
    const d = new Date(fallback);
    d.setDate(d.getDate() + 2);
    return { date: d, mentioned: true };
  }
  if (/\bamanha\b/.test(folded)) {
    const d = new Date(fallback);
    d.setDate(d.getDate() + 1);
    return { date: d, mentioned: true };
  }

  const named = folded.match(
    /\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]] ?? MONTHS[fold(named[2])];
    const yearMatch = folded.match(
      new RegExp(`${named[0]}\\s*(?:de\\s*)?(\\d{4})`),
    );
    let year = yearMatch ? Number(yearMatch[1]) : fallback.getFullYear();
    let dt = dateFromParts(year, month, day);
    if (!yearMatch && dt < new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate())) {
      dt = dateFromParts(year + 1, month, day);
    }
    return { date: dt, mentioned: true };
  }

  const slash = folded.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    let year = slash[3]
      ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
      : fallback.getFullYear();
    let dt = dateFromParts(year, month, day);
    if (!slash[3] && dt < new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate())) {
      dt = dateFromParts(year + 1, month, day);
    }
    return { date: dt, mentioned: true };
  }

  return { date: fallback, mentioned: false };
}

function hourPeriod(hour12: number, period?: string): number {
  if (!period) return hour12;
  if (period.includes("madrugada")) return hour12 % 12;
  if (period.includes("manha")) return hour12 % 12;
  if (period.includes("tarde")) return hour12 < 12 ? hour12 + 12 : hour12;
  if (period.includes("noite")) {
    if (hour12 === 12) return 0;
    return hour12 < 12 ? hour12 + 12 : hour12;
  }
  return hour12;
}

function parseTime(folded: string): { start?: string; end?: string } {
  if (/\bmeia[\s-]?noite\b/.test(folded)) {
    return { start: "00:00" };
  }
  if (/\bmeio[\s-]?dia\b/.test(folded)) {
    return { start: "12:00" };
  }

  const range = folded.match(
    /\bdas?\s+(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:as|ate)\s+(\d{1,2})(?:[:h](\d{2}))?\s*h?/,
  );
  if (range) {
    const sh = Number(range[1]);
    const sm = range[2] ? Number(range[2]) : 0;
    const eh = Number(range[3]);
    const em = range[4] ? Number(range[4]) : 0;
    if (sh <= 23 && eh <= 23) {
      return { start: `${pad2(sh)}:${pad2(sm)}`, end: `${pad2(eh)}:${pad2(em)}` };
    }
  }

  const ate = folded.match(/\bate\s+(?:as\s+)?(\d{1,2})(?:[:h](\d{2}))?\s*h?/);

  const wordHour: Record<string, number> = {
    uma: 1,
    duas: 2,
    tres: 3,
    três: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
  };

  const spoken = folded.match(
    /\b(uma|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(?:horas?\s+)?da\s+(manha|tarde|noite|madrugada)\b/,
  );
  if (spoken) {
    const h = hourPeriod(wordHour[spoken[1]] ?? 0, spoken[2]);
    const start = `${pad2(h)}:00`;
    return { start, end: ate ? `${pad2(Number(ate[1]))}:${pad2(ate[2] ? Number(ate[2]) : 0)}` : addHoursHHmm(start, 3) };
  }

  const asClock = folded.match(
    /\b(?:as|às)\s+(\d{1,2})(?:[:h](\d{2}))?\s*(?:h(?:oras?)?)?\s*(?:da\s+(manha|tarde|noite|madrugada))?\b/,
  );
  const hClock = folded.match(
    /\b(\d{1,2})\s*h(?:oras?)?(?:\s*(?:e\s*)?(\d{2}))?\s*(?:da\s+(manha|tarde|noite|madrugada))?\b/,
  );
  const colon = folded.match(
    /\b(\d{1,2}):(\d{2})\s*(?:da\s+(manha|tarde|noite|madrugada))?\b/,
  );
  const m = asClock ?? hClock ?? colon;
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const period = m[3];
    if (period) h = hourPeriod(h > 12 ? h - 12 : h, period);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const start = `${pad2(h)}:${pad2(min)}`;
      if (ate) {
        return { start, end: `${pad2(Number(ate[1]))}:${pad2(ate[2] ? Number(ate[2]) : 0)}` };
      }
      return { start, end: addHoursHHmm(start, 3) };
    }
  }

  return {};
}

function addHoursHHmm(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setHours(d.getHours() + hours);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseCity(folded: string): string | undefined {
  const m = folded.match(
    /\b(?:em|cidade)\s+([a-z\s]{2,40}?)(?=\s+(?:valor|cache|preco|dia|as|ate|pago|ja|adiantado|antecipado|hora|telefone|whatsapp|zap|estado|despesa|confirmado|ensaio|no dia)|$)/,
  );
  if (!m) return undefined;
  let city = m[1].trim().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
  for (const s of BRAZIL_STATES) {
    const n = fold(s.name);
    if (n === "para") continue;
    city = city.replace(new RegExp(`\\s+${n.replace(/\s+/g, "\\s+")}$`), "");
  }
  if (city.length < 2) return undefined;
  return city.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseUf(folded: string): string | undefined {
  const named = BRAZIL_STATES.find((s) => {
    const n = fold(s.name);
    if (n === "para") return /\bestado\s+para\b/.test(folded);
    return new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`).test(folded);
  });
  if (named) return named.uf;
  const ufTok = folded.match(/\b(?:estado|uf)\s+([a-z]{2})\b/);
  if (ufTok) {
    const uf = ufTok[1].toUpperCase();
    if (BRAZIL_STATES.some((s) => s.uf === uf)) return uf;
  }
  return undefined;
}

function parsePhone(folded: string): string | undefined {
  const labeled = folded.match(
    /\b(?:whatsapp|zap|telefone|fone|contato|celular)\s*[:\s]*(\d[\d\s().-]{8,20})/,
  );
  const raw = labeled?.[1] ?? folded.match(/\b(\d{10,11})\b/)?.[1];
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 10) return undefined;
  return digits;
}

function parseDescription(folded: string): string | undefined {
  const m = folded.match(/\b(?:descricao|observacao|obs|detalhes?)\s+(.+)$/);
  const t = m?.[1]?.trim();
  return t && t.length >= 3 ? t : undefined;
}

function parseName(original: string, folded: string, tag: SpokenEventTag): string {
  const quoted = original.match(/["“”']([^"“”']{2,80})["“”']/);
  if (quoted) return quoted[1].trim();

  const named = original.match(
    /\b(?:evento|show|ensaio|reuni[aã]o)\s+(?:chamad[oa]\s+|na\s+|no\s+)?([^,.]{3,60}?)(?=\s+(?:dia|em\s+\d|valor|cache|as\s+\d|às)|$)/i,
  );
  if (named) {
    const n = named[1].trim();
    const foldedName = fold(n);
    const onlyDate = /^(?:dia\s+)?\d/.test(foldedName);
    const relative = /^(hoje|amanha|depois)/.test(foldedName);
    if (!onlyDate && !relative && !/^(valor|cache)/i.test(n)) {
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
  }

  if (tag === "ensaio") return "Ensaio";
  if (tag === "reunião") return "Reunião";
  if (/\bshow\b/.test(folded)) return "Show";
  return "Show";
}

export function parseSpokenEvent(transcript: string, fallbackDate: Date): SpokenEventDraft {
  const text = transcript.trim();
  const folded = fold(text);
  if (isEditUtterance(folded)) {
    const stripped = stripEditVerb(folded);
    const targeted = parseSingleFieldEdit(text, stripped, fallbackDate);
    if (targeted) return targeted;
    const core = parseSpokenEventCore(stripped, text, fallbackDate);
    return { ...core, replaceFields: inferReplaceFields(core, stripped) };
  }
  return parseSpokenEventCore(folded, text, fallbackDate);
}

const EDIT_VERB =
  /\b(?:edite|altere|altera|muda|mude|troca|troque|corrige|corrija|modifique|modifica|limpe|apague|zera|remove|remover)\b/;

function isEditUtterance(folded: string): boolean {
  return EDIT_VERB.test(folded);
}

function stripEditVerb(folded: string): string {
  return folded
    .replace(/^(?:por\s+favor\s+)?/, "")
    .replace(
      /^(?:edite|altere|altera|muda|mude|troca|troque|corrige|corrija|modifique|modifica|limpe|apague|zera|remove|remover)\s+/,
      "",
    )
    .replace(/^(?:o|a|os|as)\s+/, "")
    .trim();
}

function baseDraft(transcript: string, fallbackDate: Date): SpokenEventDraft {
  return {
    transcript,
    nome: "",
    dataISO: toLocalISODate(fallbackDate),
    dateMentioned: false,
    tag: "evento",
    confirmed: true,
    despesas: [],
  };
}

function parseSingleFieldEdit(
  original: string,
  stripped: string,
  fallbackDate: Date,
): SpokenEventDraft | null {
  const draft = baseDraft(original, fallbackDate);
  const afterPara = (re: RegExp) => {
    const m = stripped.match(re);
    return m?.[1]?.trim() ?? "";
  };

  const nomeTail = afterPara(
    /^(?:nome|titulo)(?:\s+do\s+evento)?\s*(?:para|pra|pro|:)?\s*(.*)$/,
  );
  if (/^(?:nome|titulo)\b/.test(stripped)) {
    draft.nome = nomeTail ? titleCasePt(nomeTail) : "";
    draft.replaceFields = ["nome"];
    return draft;
  }

  if (
    /^(?:valor\s+pago|valor\s+antecipado|pago\s+antecipado|ja\s+pago|adiantado|antecipado)\b/.test(
      stripped,
    )
  ) {
    const tail = afterPara(
      /^(?:valor\s+pago|valor\s+antecipado|pago\s+antecipado|ja\s+pago|adiantado|antecipado)\s*(?:para|pra|pro|de|:)?\s*(.*)$/,
    );
    draft.valorPago = consumeMoneyAtStart(tail)?.value;
    draft.replaceFields = ["valorPago"];
    return draft;
  }

  if (/^(?:valor|cache|preco)\b/.test(stripped)) {
    const tail = afterPara(/^(?:valor|cache|preco)(?:\s+do\s+evento)?\s*(?:para|pra|pro|de|:)?\s*(.*)$/);
    draft.valor = consumeMoneyAtStart(tail)?.value;
    draft.replaceFields = ["valor"];
    return draft;
  }

  if (/^data\b/.test(stripped)) {
    const tail = afterPara(/^data\s*(?:para|pra|pro|:)?\s*(.*)$/);
    const { date, mentioned } = parseDate(tail || stripped, fallbackDate);
    draft.dataISO = toLocalISODate(date);
    draft.dateMentioned = mentioned || !!tail;
    draft.replaceFields = ["data"];
    return draft;
  }

  if (/^(?:cidade|local)\b/.test(stripped)) {
    const tail = afterPara(/^(?:cidade|local)\s*(?:para|pra|pro|:)?\s*(.*)$/);
    draft.cidade = tail ? titleCasePt(tail.replace(/^em\s+/, "")) : "";
    draft.replaceFields = ["cidade"];
    return draft;
  }

  if (/^(?:horario|hora|horas)\b/.test(stripped)) {
    const tail = afterPara(/^(?:horario|hora|horas)\s*(?:para|pra|pro|:)?\s*(.*)$/);
    const t = parseTime(tail || stripped);
    draft.startHHmm = t.start;
    draft.endHHmm = t.end;
    draft.replaceFields = ["horario"];
    return draft;
  }

  if (/^(?:telefone|whatsapp|zap|contato)\b/.test(stripped)) {
    const tail = afterPara(/^(?:telefone|whatsapp|zap|contato)\s*(?:para|pra|pro|:)?\s*(.*)$/);
    draft.telefone = parsePhone(tail) ?? parsePhone(stripped);
    draft.replaceFields = ["telefone"];
    return draft;
  }

  if (/^(?:descricao|observacao|obs)\b/.test(stripped)) {
    const tail = afterPara(/^(?:descricao|observacao|obs)\s*(?:para|pra|pro|:)?\s*(.*)$/);
    draft.descricao = tail;
    draft.replaceFields = ["descricao"];
    return draft;
  }

  if (/^(?:status|confirmacao)\b|^a confirmar\b|^confirmado\b/.test(stripped)) {
    draft.confirmed = !/\ba confirmar|nao confirmado|pendente\b/.test(stripped);
    draft.replaceFields = ["status"];
    return draft;
  }

  if (/^(?:tipo|tag|ensaio|reuniao)\b/.test(stripped)) {
    if (/\bensaio\b/.test(stripped)) draft.tag = "ensaio";
    else if (/\breuniao\b/.test(stripped)) draft.tag = "reunião";
    else draft.tag = "evento";
    draft.replaceFields = ["tag"];
    return draft;
  }

  if (/^despesas?\b/.test(stripped)) {
    const { items } = parseExpenses(stripped.startsWith("despesa") ? stripped : `despesa ${stripped}`);
    draft.despesas = items;
    draft.replaceFields = ["despesas"];
    return draft;
  }

  return null;
}

function inferReplaceFields(core: SpokenEventDraft, stripped: string): SpokenFieldKey[] {
  const fields: SpokenFieldKey[] = [];
  if (core.nome && core.nome !== "Show") fields.push("nome");
  if (core.valor != null) fields.push("valor");
  if (core.valorPago != null) fields.push("valorPago");
  if (core.cidade) fields.push("cidade");
  if (core.dateMentioned) fields.push("data");
  if (core.startHHmm) fields.push("horario");
  if (core.despesas.length > 0) fields.push("despesas");
  if (core.telefone) fields.push("telefone");
  if (core.estadoUf) fields.push("estadoUf");
  if (core.descricao) fields.push("descricao");
  if (/\bensaio\b|\breuniao\b/.test(stripped)) fields.push("tag");
  if (/\ba confirmar\b|\bconfirmado\b/.test(stripped)) fields.push("status");
  return fields;
}

function parseSpokenEventCore(
  folded: string,
  text: string,
  fallbackDate: Date,
): SpokenEventDraft {
  const { items: despesas, without: foldedEvent } = parseExpenses(folded);
  const source = foldedEvent || folded;

  let tag: SpokenEventTag = "evento";
  if (/\bensaio\b/.test(source)) tag = "ensaio";
  else if (/\breuniao\b/.test(source)) tag = "reunião";

  let confirmed = true;
  if (/\b(?:a confirmar|nao confirmado|pendente)\b/.test(source)) confirmed = false;
  else if (/\bconfirmado\b/.test(source)) confirmed = true;

  const { date, mentioned: dateMentioned } = parseDate(source, fallbackDate);
  const { start, end } = parseTime(source);
  const startHHmm = start;
  const endHHmm = end;

  const paid = extractMoneyAndStrip(source, PAID_KEYWORDS);
  const valorPago = paid.value;
  const afterPaid = paid.without;

  const cache = extractMoneyAndStrip(afterPaid, EVENT_VALUE_KEYWORDS);
  const valor = cache.value;
  const rest = cache.without;

  const cidade = parseCity(rest);
  const estadoUf = parseUf(rest);
  const telefone = parsePhone(rest);
  const descricao = parseDescription(rest);
  const nome = parseName(text, rest, tag);

  return {
    transcript: text,
    nome,
    valor,
    valorPago,
    cidade,
    dataISO: toLocalISODate(date),
    dateMentioned,
    startHHmm,
    endHHmm,
    tag,
    confirmed,
    despesas,
    estadoUf,
    telefone,
    descricao,
  };
}

export function spokenDraftToRouteParams(draft: SpokenEventDraft): Record<string, string> {
  const params: Record<string, string> = {
    voiceNome: draft.nome,
    voiceDate: draft.dataISO,
    voiceTag: draft.tag,
    voiceConfirmed: draft.confirmed ? "1" : "0",
    voiceTranscript: draft.transcript,
  };
  if (draft.valor != null) params.voiceValor = String(draft.valor);
  if (draft.valorPago != null) params.voiceValorPago = String(draft.valorPago);
  if (draft.cidade) params.voiceCidade = draft.cidade;
  if (draft.startHHmm) params.voiceStart = draft.startHHmm;
  if (draft.endHHmm) params.voiceEnd = draft.endHHmm;
  if (draft.despesas.length > 0) {
    params.voiceDespesas = JSON.stringify(draft.despesas);
  }
  if (draft.estadoUf) params.voiceUf = draft.estadoUf;
  if (draft.telefone) params.voicePhone = draft.telefone;
  if (draft.descricao) params.voiceDesc = draft.descricao;
  return params;
}
