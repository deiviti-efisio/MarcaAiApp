import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatCalendarDate } from '../lib/dateUtils';
import { FINANCIAL_REPORT_HTML_STYLES } from './yearlyFinancialReportHtml';

interface EventWithExpenses {
  id: string;
  name: string;
  event_date: string;
  value?: number;
  expenses: any[];
  totalExpenses: number;
  description?: string;
  city?: string;
}

interface StandaloneTransaction {
  id: string;
  description: string;
  value: number;
  date: string;
  category?: string;
}

interface FinancialReportData {
  events: EventWithExpenses[];
  month: number;
  year: number;
  artistName?: string;
  includeFinancials?: boolean;
  standaloneIncome?: StandaloneTransaction[];
  standaloneExpenses?: StandaloneTransaction[];
}

export const generateFinancialReport = async (data: FinancialReportData): Promise<{ success: boolean; error?: string; uri?: string }> => {
  console.log('🚀 === INÍCIO DA GERAÇÃO DO RELATÓRIO FINANCEIRO ===');
  console.log('📊 Dados recebidos:', {
    eventos: data.events?.length || 0,
    mes: data.month,
    ano: data.year,
    artista: data.artistName,
    incluirFinanceiro: data.includeFinancials,
    receitasAvulsas: data.standaloneIncome?.length || 0,
    despesasAvulsas: data.standaloneExpenses?.length || 0
  });
  
  try {
    const { 
      events, 
      month, 
      year, 
      artistName, 
      includeFinancials = true,
      standaloneIncome = [],
      standaloneExpenses = []
    } = data;
    
    console.log('✅ Dados extraídos com sucesso');
    
    // Calcular totais dos eventos
    console.log('💰 Calculando totais dos eventos...');
    const totalRevenue = events.reduce((sum, event) => sum + (event.value || 0), 0);
    const totalExpenses = events.reduce((sum, event) => sum + event.totalExpenses, 0);
    console.log('Receitas eventos:', totalRevenue, 'Despesas eventos:', totalExpenses);
    
    // Calcular totais das transações avulsas
    console.log('💰 Calculando totais das transações avulsas...');
    const standaloneIncomeTotal = standaloneIncome.reduce((sum, income) => sum + Math.abs(income.value), 0);
    const standaloneExpensesTotal = standaloneExpenses.reduce((sum, expense) => sum + expense.value, 0);
    console.log('Receitas avulsas:', standaloneIncomeTotal, 'Despesas avulsas:', standaloneExpensesTotal);
    
    // Totais gerais
    const totalRevenueWithIncome = totalRevenue + standaloneIncomeTotal;
    const totalExpensesWithStandalone = totalExpenses + standaloneExpensesTotal;
    const netProfit = totalRevenueWithIncome - totalExpensesWithStandalone;
    console.log('💵 TOTAIS GERAIS:', {
      receitaTotal: totalRevenueWithIncome,
      despesaTotal: totalExpensesWithStandalone,
      lucroLiquido: netProfit
    });
    
    // Obter dia da semana
    const getDayOfWeek = (dateString: string) => {
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const daysOfWeek = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      return daysOfWeek[date.getDay()];
    };
    
    // Formatar moeda
    const formatCurrency = (value: number) => {
      return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });
    };
    
    // Formatar número sem símbolo
    const formatNumber = (value: number) => {
      return value.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    };
    
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    // Criar HTML formatado para o PDF
    console.log('🎨 Criando HTML do relatório...');
    console.log('📅 Mês/Ano:', months[month], year);
    const now = new Date();
    const dataGeracao = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}hs`;
    console.log('📅 Data de geração:', dataGeracao);
    
    console.log('📊 Dados do relatório:', {
      eventos: events.length,
      receitasAvulsas: standaloneIncome.length,
      despesasAvulsas: standaloneExpenses.length,
      includeFinancials
    });
    
    // Avisar se há muitos dados
    const totalItems = events.length + standaloneIncome.length + standaloneExpenses.length;
    if (totalItems > 50) {
      console.warn('⚠️ Grande quantidade de dados:', totalItems, 'itens - pode demorar mais');
    }
    
    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>${FINANCIAL_REPORT_HTML_STYLES}</style>
      </head>
      <body>
        <!-- Cabeçalho -->
        <div class="header-section">
          <div class="logo">
            <div class="logo-inner">
              <div class="logo-text">MS</div>
            </div>
          </div>
          <div class="header-content">
            ${artistName ? `<h1 class="artist-name">${artistName.toUpperCase()}</h1>` : ''}
            <h2 class="report-title">Relatório financeiro · ${months[month]} / ${year}</h2>
            <p class="generated-info">Gerado em ${dataGeracao} · MeuShow</p>
          </div>
        </div>
        
        <div class="header-divider"></div>

        ${events.length > 0 ? `
        <!-- Detalhamento dos Eventos -->
        <h3 class="section-title">Detalhamento dos eventos</h3>
        ${includeFinancials ? events.map((event, index) => `
          <div class="event-card">
            <div class="event-card-title">
              ${index + 1}. ${event.name} · ${formatCalendarDate(event.event_date)}
            </div>
            <table class="event-table cols-2">
              <thead>
                <tr>
                  <th class="cell-desc">Descrição</th>
                  <th class="cell-val">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="cell-desc">Receita do evento</td>
                  <td class="cell-val">${formatNumber(event.value || 0)}</td>
                </tr>
                ${event.expenses.length > 0 ? event.expenses.map(expense => `
                <tr>
                  <td class="cell-desc">${expense.name}</td>
                  <td class="cell-val">− ${formatNumber(expense.value)}</td>
                </tr>
                `).join('') : ''}
                <tr class="total-row">
                  <td class="cell-desc">Lucro líquido</td>
                  <td class="cell-val">${formatNumber((event.value || 0) - event.totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `).join('') : `
          <table class="event-table cols-3-agenda">
            <thead>
              <tr>
                <th class="cell-desc">Evento</th>
                <th class="cell-date">Data</th>
                <th class="cell-city">Cidade</th>
              </tr>
            </thead>
            <tbody>
              ${events.map(event => `
              <tr>
                <td class="cell-desc">${event.name}</td>
                <td class="cell-date">
                  <strong>${getDayOfWeek(event.event_date)}</strong><br/>
                  ${formatCalendarDate(event.event_date)}
                </td>
                <td class="cell-city">${event.city || '—'}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        `}
        
        <!-- Receitas Avulsas -->
        ${includeFinancials && standaloneIncome.length > 0 ? `
        <h3 class="section-title">Receitas avulsas</h3>
        <table class="event-table">
          <thead>
            <tr>
              <th class="cell-desc">Descrição</th>
              <th class="cell-date">Data</th>
              <th class="cell-val">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${standaloneIncome.map(income => `
            <tr>
              <td class="cell-desc">${income.description}</td>
              <td class="cell-date">${formatCalendarDate(income.date)}</td>
              <td class="cell-val">${formatNumber(Math.abs(income.value))}</td>
            </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="2" class="cell-desc">Total receitas avulsas</td>
              <td class="cell-val">${formatNumber(standaloneIncomeTotal)}</td>
            </tr>
          </tbody>
        </table>
        ` : ''}

        <!-- Despesas Avulsas -->
        ${includeFinancials && standaloneExpenses.length > 0 ? `
        <h3 class="section-title">Despesas avulsas</h3>
        <table class="event-table">
          <thead>
            <tr>
              <th class="cell-desc">Descrição</th>
              <th class="cell-date">Data</th>
              <th class="cell-val">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${standaloneExpenses.map(expense => `
            <tr>
              <td class="cell-desc">${expense.description}</td>
              <td class="cell-date">${formatCalendarDate(expense.date)}</td>
              <td class="cell-val">${formatNumber(expense.value)}</td>
            </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="2" class="cell-desc">Total despesas avulsas</td>
              <td class="cell-val">${formatNumber(standaloneExpensesTotal)}</td>
            </tr>
          </tbody>
        </table>
        ` : ''}
        
        <!-- Resumo Financeiro -->
        ${includeFinancials ? `
        <div class="summary-section">
          <div class="summary-title">Resumo do período</div>
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-label">Receitas totais</div>
              <div class="summary-value">${formatCurrency(totalRevenueWithIncome)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Despesas totais</div>
              <div class="summary-value">${formatCurrency(totalExpensesWithStandalone)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Lucro líquido</div>
              <div class="summary-value">${formatCurrency(netProfit)}</div>
            </div>
          </div>
        </div>
        ` : ''}
        ` : `
        <div class="empty-state">
          <p style="font-size: 18px; margin-bottom: 10px;">Nenhum evento encontrado</p>
          <p>Não foram encontrados eventos para o período selecionado.</p>
        </div>
        `}

        <div class="footer">
          <p>MeuShow · Gestão de shows e eventos</p>
          <p>${includeFinancials ? 'Relatório com valores financeiros' : 'Relatório sem valores financeiros'}</p>
        </div>
      </body>
    </html>
    `;

    console.log('📏 Tamanho do HTML:', (htmlContent.length / 1024).toFixed(2), 'KB');

    try {
      console.log('🔄 Verificando disponibilidade de compartilhamento...');
      // Verificar se compartilhamento está disponível
      console.log('🔍 Verificando disponibilidade de compartilhamento...');
      const isAvailable = await Sharing.isAvailableAsync();
      console.log('📱 Compartilhamento disponível:', isAvailable);
      
      if (!isAvailable) {
        console.error('❌ Compartilhamento não disponível');
        return { success: false, error: 'Compartilhamento não disponível neste dispositivo' };
      }

      console.log('📄 Iniciando geração do PDF...');
      console.log('⏰ Hora de início:', new Date().toISOString());
      console.log('📏 Tamanho do HTML:', htmlContent.length, 'caracteres');
      
      // Gerar PDF usando expo-print com timeout de 30 segundos
      const printStart = Date.now();
      
      // Gerar PDF (sem base64 primeiro, mais rápido)
      const pdfPromise = Print.printToFileAsync({ 
        html: htmlContent,
        base64: false
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: A geração do relatório excedeu 30 segundos. Tente reduzir o período ou gerar sem valores financeiros.')), 30000)
      );
      
      const result = await Promise.race([pdfPromise, timeoutPromise]);
      const uri = result.uri;
      
      const printTime = ((Date.now() - printStart) / 1000).toFixed(2);
      console.log(`✅ PDF gerado em ${printTime}s`);
      console.log('📄 URI gerado:', uri);
      
      if (!uri) {
        console.error('❌ URI do PDF vazio após printToFileAsync');
        return { success: false, error: 'Falha ao gerar arquivo PDF (URI vazio)' };
      }
      
      // Copiar diretamente para documentDirectory (mais rápido que base64)
      const fileName = `Relatorio_Financeiro_${months[month]}_${year}_${Date.now()}.pdf`;
      const shareableUri = `${FileSystem.documentDirectory}${fileName}`;
      
      console.log('📦 Copiando PDF para documentDirectory:', shareableUri);
      
      // Usar copyAsync é mais rápido e leve que base64
      await FileSystem.copyAsync({
        from: uri,
        to: shareableUri
      });
      
      console.log('✅ PDF copiado com sucesso!');
      
      // Verificar se foi copiado
      const fileInfo = await FileSystem.getInfoAsync(shareableUri);
      if (!fileInfo.exists) {
        throw new Error('Falha ao copiar PDF para documentDirectory');
      }
      
      // Retornar URI para compartilhar depois (fora do modal)
      return { success: true, uri: shareableUri };
    } catch (pdfError: any) {
      console.error('❌ Erro ao gerar/compartilhar PDF:', pdfError);
      console.error('Stack trace:', pdfError?.stack);
      
      let errorMessage = 'Erro ao gerar documento';
      if (pdfError?.message?.includes('Timeout')) {
        errorMessage = pdfError.message;
      } else if (pdfError?.message) {
        errorMessage = pdfError.message;
      }
      
      return { success: false, error: errorMessage };
    }
  } catch (error: any) {
    const errorMessage = error?.message || 'Erro desconhecido';
    return { success: false, error: errorMessage };
  }
};

// ——— Relatório anual (cada mês detalhado) ———

export interface YearlyReportMonthBlock {
  monthIndex: number;
  events: EventWithExpenses[];
  standaloneIncome: StandaloneTransaction[];
  standaloneExpenses: StandaloneTransaction[];
}

export interface YearlyFinancialReportData {
  year: number;
  artistName?: string;
  includeFinancials?: boolean;
  months: YearlyReportMonthBlock[];
}

const expenseLineLabel = (e: { name?: string; description?: string }) =>
  (e.name || e.description || 'Despesa').trim();

export const generateYearlyFinancialReport = async (
  data: YearlyFinancialReportData
): Promise<{ success: boolean; error?: string; uri?: string }> => {
  const monthsPt = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];

  try {
    const { year, artistName, includeFinancials = true, months: monthBlocks } = data;

    const getDayOfWeek = (dateString: string) => {
      const [y, m, d] = dateString.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const daysOfWeek = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado',
      ];
      return daysOfWeek[date.getDay()];
    };

    const formatCurrency = (value: number) =>
      value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const formatNumber = (value: number) =>
      value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let totalRevEvents = 0;
    let totalExpEvents = 0;
    let totalStandaloneInc = 0;
    let totalStandaloneExp = 0;

    for (const block of monthBlocks) {
      for (const ev of block.events) {
        totalRevEvents += ev.value || 0;
        totalExpEvents += ev.totalExpenses;
      }
      totalStandaloneInc += block.standaloneIncome.reduce((s, i) => s + Math.abs(i.value), 0);
      totalStandaloneExp += block.standaloneExpenses.reduce((s, e) => s + e.value, 0);
    }

    const totalRevenueWithIncome = totalRevEvents + totalStandaloneInc;
    const totalExpensesAll = totalExpEvents + totalStandaloneExp;
    const netProfit = totalRevenueWithIncome - totalExpensesAll;

    const now = new Date();
    const dataGeracao = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}hs`;

    const renderMonthBody = (block: YearlyReportMonthBlock): string => {
      const { monthIndex, events, standaloneIncome, standaloneExpenses } = block;
      const mLabel = monthsPt[monthIndex];
      const hasAny =
        events.length > 0 || standaloneIncome.length > 0 || standaloneExpenses.length > 0;

      const evCount = events.length;
      const evLabel = evCount === 1 ? 'evento' : 'eventos';
      let html = `<h3 class="section-title">${mLabel} · ${year}<span class="month-event-meta">${evCount} ${evLabel}</span></h3>`;

      if (!hasAny) {
        html += `<div class="empty-month">Sem movimentação neste mês.</div>`;
        return html;
      }

      if (events.length > 0) {
        html += `<h4 class="subsection-title">Eventos</h4>`;
        if (includeFinancials) {
          html += events
            .map(
              (event, index) => `
          <div class="event-card">
            <div class="event-card-title">
              ${index + 1}. ${event.name} · ${formatCalendarDate(event.event_date)}
            </div>
            <table class="event-table cols-2">
              <thead>
                <tr>
                  <th class="cell-desc">Descrição</th>
                  <th class="cell-val">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="cell-desc">Receita do evento</td>
                  <td class="cell-val">${formatNumber(event.value || 0)}</td>
                </tr>
                ${event.expenses.length > 0
                  ? event.expenses
                      .map(
                        (expense) => `
                <tr>
                  <td class="cell-desc">${expenseLineLabel(expense)}</td>
                  <td class="cell-val">− ${formatNumber(expense.value)}</td>
                </tr>
                `
                      )
                      .join('')
                  : ''}
                <tr class="total-row">
                  <td class="cell-desc">Lucro líquido</td>
                  <td class="cell-val">${formatNumber((event.value || 0) - event.totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `
            )
            .join('');
        } else {
          html += `
          <table class="event-table cols-3-agenda">
            <thead>
              <tr>
                <th class="cell-desc">Evento</th>
                <th class="cell-date">Data</th>
                <th class="cell-city">Cidade</th>
              </tr>
            </thead>
            <tbody>
              ${events
                .map(
                  (event) => `
              <tr>
                <td class="cell-desc">${event.name}</td>
                <td class="cell-date">
                  <strong>${getDayOfWeek(event.event_date)}</strong><br/>
                  ${formatCalendarDate(event.event_date)}
                </td>
                <td class="cell-city">${event.city || '—'}</td>
              </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `;
        }
      }

      if (includeFinancials && standaloneIncome.length > 0) {
        const incTotal = standaloneIncome.reduce((s, i) => s + Math.abs(i.value), 0);
        html += `<h4 class="subsection-title">Receitas avulsas</h4>`;
        html += `
        <table class="event-table">
          <thead>
            <tr>
              <th class="cell-desc">Descrição</th>
              <th class="cell-date">Data</th>
              <th class="cell-val">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${standaloneIncome
              .map(
                (income) => `
            <tr>
              <td class="cell-desc">${income.description}</td>
              <td class="cell-date">${formatCalendarDate(income.date)}</td>
              <td class="cell-val">${formatNumber(Math.abs(income.value))}</td>
            </tr>
            `
              )
              .join('')}
            <tr class="total-row">
              <td colspan="2" class="cell-desc">Total receitas avulsas · ${mLabel}</td>
              <td class="cell-val">${formatNumber(incTotal)}</td>
            </tr>
          </tbody>
        </table>
        `;
      }

      if (includeFinancials && standaloneExpenses.length > 0) {
        const expTotal = standaloneExpenses.reduce((s, e) => s + e.value, 0);
        html += `<h4 class="subsection-title">Despesas avulsas</h4>`;
        html += `
        <table class="event-table">
          <thead>
            <tr>
              <th class="cell-desc">Descrição</th>
              <th class="cell-date">Data</th>
              <th class="cell-val">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${standaloneExpenses
              .map(
                (expense) => `
            <tr>
              <td class="cell-desc">${expense.description}</td>
              <td class="cell-date">${formatCalendarDate(expense.date)}</td>
              <td class="cell-val">${formatNumber(expense.value)}</td>
            </tr>
            `
              )
              .join('')}
            <tr class="total-row">
              <td colspan="2" class="cell-desc">Total despesas avulsas · ${mLabel}</td>
              <td class="cell-val">${formatNumber(expTotal)}</td>
            </tr>
          </tbody>
        </table>
        `;
      }

      return html;
    };

    const monthsHtml = `<div class="months-wrap">${monthBlocks
      .map((block) => `<div class="month-block">${renderMonthBody(block)}</div>`)
      .join('')}</div>`;

    const summaryYearHtml = includeFinancials
      ? `
        <div class="summary-section">
          <div class="summary-title">Resumo do ano ${year}</div>
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-label">Receitas totais</div>
              <div class="summary-value">${formatCurrency(totalRevenueWithIncome)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Despesas totais</div>
              <div class="summary-value">${formatCurrency(totalExpensesAll)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Lucro líquido</div>
              <div class="summary-value">${formatCurrency(netProfit)}</div>
            </div>
          </div>
        </div>
      `
      : '';

    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>${FINANCIAL_REPORT_HTML_STYLES}</style>
      </head>
      <body>
        <div class="header-section">
          <div class="logo">
            <div class="logo-inner">
              <div class="logo-text">MS</div>
            </div>
          </div>
          <div class="header-content">
            ${artistName ? `<h1 class="artist-name">${artistName.toUpperCase()}</h1>` : ''}
            <h2 class="report-title">Relatório financeiro · ano ${year}</h2>
            <p class="generated-info">Detalhamento por mês · Gerado em ${dataGeracao} · MeuShow</p>
          </div>
        </div>
        <div class="header-divider"></div>
        ${monthsHtml}
        ${summaryYearHtml}
        <div class="footer">
          <p>MeuShow · Gestão de shows e eventos</p>
          <p>${includeFinancials ? 'Relatório anual com valores financeiros' : 'Relatório anual sem valores financeiros'}</p>
        </div>
      </body>
    </html>
    `;

    const totalItems = monthBlocks.reduce(
      (acc, b) =>
        acc + b.events.length + b.standaloneIncome.length + b.standaloneExpenses.length,
      0
    );
    if (totalItems > 120) {
      console.warn('⚠️ Relatório anual com muitos itens:', totalItems);
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: 'Compartilhamento não disponível neste dispositivo' };
    }

    const timeoutMs = 90000;
    const pdfPromise = Print.printToFileAsync({ html: htmlContent, base64: false });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timeout: a geração do relatório anual excedeu ${timeoutMs / 1000} segundos. Tente exportar sem valores ou um ano com menos eventos.`
            )
          ),
        timeoutMs
      )
    );

    const result = await Promise.race([pdfPromise, timeoutPromise]);
    const uri = result.uri;
    if (!uri) {
      return { success: false, error: 'Falha ao gerar arquivo PDF (URI vazio)' };
    }

    const fileName = `Relatorio_Financeiro_Ano_${year}_${Date.now()}.pdf`;
    const shareableUri = `${FileSystem.documentDirectory}${fileName}`;
    await FileSystem.copyAsync({ from: uri, to: shareableUri });

    const fileInfo = await FileSystem.getInfoAsync(shareableUri);
    if (!fileInfo.exists) {
      throw new Error('Falha ao copiar PDF para documentDirectory');
    }

    return { success: true, uri: shareableUri };
  } catch (pdfError: unknown) {
    const msg =
      pdfError && typeof pdfError === 'object' && 'message' in pdfError
        ? String((pdfError as { message: unknown }).message)
        : 'Erro ao gerar documento';
    return { success: false, error: msg };
  }
};
