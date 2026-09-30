import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatCalendarDate } from '../lib/dateUtils';
import { getMeuShowWordmarkDataUri, meuShowPdfLogoHtml } from '../utils/meuShowLogoDataUri';

export type DetalhesPdfSlice = { value: number; color: string; label: string };

export interface FinanceiroDetalhesPdfData {
  artistName?: string;
  month: number;
  year: number;
  pieSlices: DetalhesPdfSlice[];
  pieTotal: number;
  totals: {
    totalRevenueWithIncome: number;
    totalExpenses: number;
    netProfit: number;
    eventCount: number;
    expenseEntriesCount: number;
    totalEventProfits: number;
  };
  topExpenses: { name: string; value: number; source: string }[];
  topProfits: { name: string; profit: number; date: string }[];
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNum(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Cor #hex vinda das fatias (evita atributo inválido no HTML do PDF). */
function safeHexColor(color: string): string {
  const t = color.trim();
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(t) ? t : '#6366f1';
}

/** Porcentagens inteiras que somam 100 (largura de colunas na barra horizontal). */
function barWidthPercents(values: number[], sum: number): number[] {
  if (values.length === 0 || sum <= 0) return [];
  const floors = values.map((v) => Math.floor((Math.max(v, 0) / sum) * 100));
  const remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const out = [...floors];
  if (out.length > 0) out[out.length - 1] += remainder;
  return out;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

/** Margem superior extra (pt) em todas as páginas — corrige conteúdo colado no topo na 2ª página (WKWebView). */
const PDF_TOP_MARGIN_PT = 56;

/**
 * Recria o PDF com altura de página maior no topo, mantendo o conteúdo na base — margem visual no topo em todas as páginas.
 */
async function addTopMarginToAllPages(sourceUri: string, destUri: string, topPts: number): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const srcBytes = base64ToUint8Array(base64);
  const srcDoc = await PDFDocument.load(srcBytes);
  const pageCount = srcDoc.getPageCount();
  const allIndices = Array.from({ length: pageCount }, (_, i) => i);
  const newDoc = await PDFDocument.create();
  const embeddedPages = await newDoc.embedPdf(srcBytes, allIndices);
  for (const emb of embeddedPages) {
    const { width, height } = emb;
    const page = newDoc.addPage([width, height + topPts]);
    page.drawPage(emb, { x: 0, y: 0, width, height });
  }
  const outBytes = await newDoc.save();
  await FileSystem.writeAsStringAsync(destUri, uint8ArrayToBase64(outBytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/**
 * "Página N de M" centralizado no rodapé (sem apagar conteúdo da página).
 */
async function stampPageNumbersOnPdf(sourceUri: string, destUri: string): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const pdfDoc = await PDFDocument.load(base64ToUint8Array(base64));
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const total = pages.length;
  const fontSize = 8.5;
  pages.forEach((page, idx) => {
    const { width } = page.getSize();
    const text = `Página ${idx + 1} de ${total}`;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 9,
      size: fontSize,
      font,
      color: rgb(0.38, 0.38, 0.38),
    });
  });
  const outBytes = await pdfDoc.save();
  await FileSystem.writeAsStringAsync(destUri, uint8ArrayToBase64(outBytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function generateFinanceiroDetalhesPdf(
  data: FinanceiroDetalhesPdfData
): Promise<{ success: boolean; error?: string; uri?: string }> {
  const {
    artistName,
    month,
    year,
    pieSlices,
    pieTotal,
    totals,
    topExpenses,
    topProfits,
  } = data;

  const now = new Date();
  const dataGeracao = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
  const logoSrc = await getMeuShowWordmarkDataUri();

  const positive = pieSlices.filter((s) => s.value > 0);
  const total = pieTotal > 0 ? pieTotal : positive.reduce((a, s) => a + s.value, 0);

  const slicePercents =
    total > 0 && positive.length > 0
      ? barWidthPercents(
          positive.map((s) => Math.max(s.value, 0)),
          total
        )
      : [];

  const maxColPx = 108;
  /** Tabelas + atributo bgcolor: o WebView do expo-print costuma ignorar flex e background só em CSS. */
  const columnChart =
    total <= 0 || positive.length === 0
      ? ''
      : `<table class="chart-cols" width="100%" cellpadding="0" cellspacing="8" style="width:100%;margin-bottom:14px;border-collapse:separate;border-spacing:8px;">
          <tr>
            ${positive
              .map((s) => {
                const h = Math.max(10, Math.round((s.value / total) * maxColPx));
                const bg = safeHexColor(s.color);
                return `<td valign="bottom" align="center" style="padding:0;vertical-align:bottom;">
                  <table width="28" align="center" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td height="${h}" bgcolor="${bg}" style="height:${h}px;width:28px;background-color:${bg};font-size:1px;line-height:${h}px;border-radius:6px;">&nbsp;</td>
                    </tr>
                  </table>
                </td>`;
              })
              .join('')}
          </tr>
        </table>`;

  const horizontalBarTable =
    total <= 0 || positive.length === 0
      ? ''
      : `<table class="chart-bar" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e5e7eb" style="width:100%;height:32px;border-collapse:collapse;background-color:#e5e7eb;">
          <tr>
            ${positive
              .map((s, idx) => {
                const pct = slicePercents[idx] ?? 0;
                const bg = safeHexColor(s.color);
                return `<td width="${pct}%" bgcolor="${bg}" style="width:${pct}%;height:32px;padding:0;margin:0;background-color:${bg};font-size:1px;line-height:32px;">&nbsp;</td>`;
              })
              .join('')}
          </tr>
        </table>`;

  const barSegments =
    total <= 0 || positive.length === 0
      ? `<div style="padding:16px;text-align:center;color:#666;background-color:#f3f4f6;border-radius:8px;">Sem receita para exibir no gráfico.</div>`
      : `${columnChart}
        ${horizontalBarTable}
        <p style="margin-top:10px;font-size:14px;font-weight:700;text-align:center;color:#111;">
          Receita total · ${formatBRL(total)}
        </p>`;

  const legendRows =
    total <= 0 || positive.length === 0
      ? ''
      : positive
          .map((sl) => {
            const pct = total > 0 ? (sl.value / total) * 100 : 0;
            return `<tr>
            <td style="padding:8px 10px;border:1px solid #ddd;width:36px;text-align:center;vertical-align:middle;">
              <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td width="14" height="14" bgcolor="${safeHexColor(sl.color)}" style="width:14px;height:14px;background-color:${safeHexColor(sl.color)};border-radius:4px;font-size:1px;line-height:14px;">&nbsp;</td>
                </tr>
              </table>
            </td>
            <td style="padding:8px 10px;border:1px solid #ddd;font-size:13px;">${escapeHtml(sl.label)}</td>
            <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;font-size:13px;font-weight:600;">${formatBRL(sl.value)}</td>
            <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;font-size:12px;color:#555;">${pct.toFixed(1)}%</td>
          </tr>`;
          })
          .join('');

  const despesasRows =
    topExpenses.length === 0
      ? `<tr><td colspan="3" style="padding:14px;text-align:center;color:#666;">Nenhuma despesa neste mês.</td></tr>`
      : topExpenses
          .map(
            (row) => `<tr>
          <td style="padding:8px 10px;border:1px solid #ddd;font-size:13px;">${escapeHtml(row.name)}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-size:12px;color:#555;">${escapeHtml(row.source)}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;font-size:13px;color:#b91c1c;">R$ ${formatNum(row.value)}</td>
        </tr>`
          )
          .join('') +
        `<tr style="font-weight:700;background:#f3f4f6;">
          <td colspan="2" style="padding:10px;border:1px solid #ddd;">Total</td>
          <td style="padding:10px;border:1px solid #ddd;text-align:right;color:#b91c1c;">R$ ${formatNum(totals.totalExpenses)}</td>
        </tr>`;

  const lucrosRows =
    topProfits.length === 0
      ? `<tr><td colspan="3" style="padding:14px;text-align:center;color:#666;">Nenhum evento neste mês.</td></tr>`
      : topProfits
          .map((row) => {
            const cor = row.profit >= 0 ? '#15803d' : '#b91c1c';
            return `<tr>
          <td style="padding:8px 10px;border:1px solid #ddd;font-size:13px;">${escapeHtml(row.name)}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-size:12px;color:#555;">${escapeHtml(formatCalendarDate(row.date))}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;font-size:13px;font-weight:600;color:${cor};">R$ ${formatNum(row.profit)}</td>
        </tr>`;
          })
          .join('') +
        `<tr style="font-weight:700;background:#f3f4f6;">
          <td colspan="2" style="padding:10px;border:1px solid #ddd;">Total (soma por evento)</td>
          <td style="padding:10px;border:1px solid #ddd;text-align:right;color:${totals.totalEventProfits >= 0 ? '#15803d' : '#b91c1c'};">R$ ${formatNum(totals.totalEventProfits)}</td>
        </tr>`;

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    @page {
      size: A4 portrait;
      margin: 16mm 14mm 22mm 14mm;
    }
    @media print {
      @page {
        margin: 16mm 14mm 22mm 14mm;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
      }
    }
    * {
      margin:0;
      padding:0;
      box-sizing:border-box;
      -webkit-print-color-adjust:exact !important;
      print-color-adjust:exact !important;
    }
    html {
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color:#111;
      background:#fff;
      line-height:1.45;
      font-size:13px;
    }
    .section-keep {
      page-break-inside: avoid;
      break-inside: avoid;
      -webkit-region-break-inside: avoid;
      margin-bottom: 6px;
    }
    .section-allow-break {
      margin-bottom: 8px;
    }
    .header-section { display:block; width:100%; text-align:center; margin-bottom:12px; page-break-inside:avoid; break-inside:avoid; }
    .logo { width:100%; margin:0 0 10px 0; text-align:center; }
    .brand-wordmark { height:52px; width:auto; display:block; margin:0 auto; }
    .header-content { width:100%; text-align:center; }
    .artist-name { font-size:24px; font-weight:bold; color:#111; margin-bottom:4px; text-align:center; }
    .report-title { font-size:17px; font-weight:700; color:#333; margin-bottom:4px; text-align:center; }
    .generated-info { font-size:11px; color:#666; text-align:center; }
    .header-divider { height:2px; background:#333; margin:10px 0 14px; page-break-after:avoid; }
    h3 {
      font-size:15px;
      font-weight:700;
      color:#111;
      margin:18px 0 8px;
      text-transform:uppercase;
      letter-spacing:0.5px;
      page-break-after:avoid;
      break-after:avoid;
      orphans:3;
      widows:3;
    }
    .intro { font-size:12px; color:#555; margin-bottom:8px; page-break-after:avoid; }
    .chart-box { margin:8px 0 6px; page-break-inside:avoid; break-inside:avoid; }
    table.data { width:100%; border-collapse:collapse; margin-top:6px; page-break-inside:auto; }
    table.data.no-split {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    table.data thead { display:table-header-group; }
    table.data tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    table.data tbody tr {
      page-break-before: auto;
    }
    table.data th { background:#f3f4f6; padding:8px 9px; text-align:left; font-size:11px; border:1px solid #ccc; }
    table.data th.num { text-align:right; }
    table.data td { padding:8px 9px; border:1px solid #ddd; font-size:12px; vertical-align:top; }
    .footer { margin-top:20px; padding-top:12px; text-align:center; color:#666; font-size:10px; page-break-inside:avoid; }
    .doc-root {
      max-width: 100%;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="doc-root">
  <div class="section-keep">
    <div class="header-section">
      <div class="logo">${meuShowPdfLogoHtml(logoSrc)}</div>
      <div class="header-content">
        ${artistName ? `<div class="artist-name">${escapeHtml(artistName.toUpperCase())}</div>` : ''}
        <div class="report-title">Detalhes financeiros · ${escapeHtml(MONTHS[month])} / ${year}</div>
        <p class="generated-info">Gerado em ${escapeHtml(dataGeracao)} · MeuShow</p>
      </div>
    </div>
    <div class="header-divider"></div>
  </div>

  <div class="section-keep">
    <h3>Distribuição da receita</h3>
    <p class="intro">Por colaborador que cadastrou o evento; receitas avulsas em fatia separada.</p>
    <div class="chart-box">${barSegments}</div>
  </div>

  ${legendRows ? `<div class="section-allow-break">
    <h3>Legenda</h3>
    <table class="data">
      <thead><tr><th style="width:36px;"></th><th>Descrição</th><th class="num">Valor</th><th class="num">% do total</th></tr></thead>
      <tbody>${legendRows}</tbody>
    </table>
  </div>` : ''}

  <div class="section-keep">
    <h3>Resumo do mês</h3>
    <table class="data no-split">
      <tbody>
        <tr><td>Receita total</td><td style="text-align:right;font-weight:700;">${formatBRL(totals.totalRevenueWithIncome)}</td></tr>
        <tr><td>Despesas totais</td><td style="text-align:right;">${formatBRL(totals.totalExpenses)}</td></tr>
        <tr><td>Lucro líquido</td><td style="text-align:right;font-weight:700;">${formatBRL(totals.netProfit)}</td></tr>
        <tr><td>Total de eventos</td><td style="text-align:right;">${totals.eventCount}</td></tr>
        <tr><td>Total de lançamentos de despesa</td><td style="text-align:right;">${totals.expenseEntriesCount}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section-allow-break">
    <h3>Maiores despesas</h3>
    <table class="data no-split">
      <thead><tr><th>Despesa</th><th>Origem</th><th class="num">Valor</th></tr></thead>
      <tbody>${despesasRows}</tbody>
    </table>
  </div>

  <div class="section-allow-break">
    <h3>Maiores lucros por evento</h3>
    <table class="data no-split">
      <thead><tr><th>Evento</th><th>Data</th><th class="num">Lucro</th></tr></thead>
      <tbody>${lucrosRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <p>MeuShow · Documento gerado automaticamente</p>
  </div>
  </div>
</body>
</html>`;

  try {
    const shareOk = await Sharing.isAvailableAsync();
    if (!shareOk) {
      return { success: false, error: 'Compartilhamento não disponível neste dispositivo' };
    }

    const result = await Print.printToFileAsync({
      html: htmlContent,
      base64: false,
      width: 595,
      height: 842,
    });
    const uri = result.uri;
    if (!uri) {
      return { success: false, error: 'Falha ao gerar PDF' };
    }

    const fileName = `Detalhes_Financeiros_${MONTHS[month]}_${year}_${Date.now()}.pdf`;
    const shareableUri = `${FileSystem.documentDirectory}${fileName}`;
    const marginPassUri = `${FileSystem.documentDirectory}_fin_det_margin_${Date.now()}.pdf`;
    try {
      await addTopMarginToAllPages(uri, marginPassUri, PDF_TOP_MARGIN_PT);
      await stampPageNumbersOnPdf(marginPassUri, shareableUri);
    } catch {
      try {
        await stampPageNumbersOnPdf(uri, shareableUri);
      } catch {
        await FileSystem.copyAsync({ from: uri, to: shareableUri });
      }
    } finally {
      await FileSystem.deleteAsync(marginPassUri, { idempotent: true }).catch(() => {});
    }

    const info = await FileSystem.getInfoAsync(shareableUri);
    if (!info.exists) {
      return { success: false, error: 'Não foi possível salvar o PDF' };
    }

    return { success: true, uri: shareableUri };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao gerar PDF';
    return { success: false, error: msg };
  }
}
