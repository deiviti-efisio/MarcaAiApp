import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { formatCalendarDate } from '../lib/dateUtils';
import { Event } from '../services/supabase/eventService';

interface EventPDFData {
  event: Event;
  totalExpenses: number;
  creatorName?: string;
  artistName?: string;
  includeFinancials?: boolean;
}

interface EventWithExpensesForPDF extends Event {
  expenses?: { name: string; value: number }[];
}

interface AgendaPDFData {
  events: EventWithExpensesForPDF[];
  month: number;
  year: number;
  artistName?: string;
  includeFinancials?: boolean;
}

export const generateEventPDF = async (data: EventPDFData): Promise<{ success: boolean; error?: string }> => {
  try {
    const { event, totalExpenses, creatorName, artistName, includeFinancials = true } = data;
    
    // Calcular lucro
    const profit = (event.value || 0) - totalExpenses;
    
    // Formatar hora
    const formatTime = (timeString: string) => {
      return timeString.substring(0, 5); // HH:MM
    };
    
    // Formatar moeda
    const formatCurrency = (value: number) => {
      return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });
    };

    // Criar HTML formatado para o PDF
    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Helvetica', 'Arial', sans-serif;
            padding: 40px;
            color: #333;
            line-height: 1.6;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid #667eea;
            padding-bottom: 20px;
          }
          .header h1 {
            color: #667eea;
            margin: 0;
            font-size: 28px;
          }
          .header p {
            color: #666;
            margin: 5px 0 0 0;
            font-size: 14px;
          }
          .section {
            margin-bottom: 30px;
            background: #f9fafb;
            padding: 20px;
            border-radius: 10px;
            page-break-inside: avoid;
          }
          .section-title {
            color: #667eea;
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
          }
          .info-row {
            display: flex;
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            font-weight: 600;
            color: #666;
            width: 150px;
          }
          .info-value {
            color: #333;
            flex: 1;
          }
          .financial-box {
            background: ${includeFinancials ? '#ecfdf5' : '#fef3c7'};
            border: 2px solid ${includeFinancials ? '#10b981' : '#f59e0b'};
            border-radius: 10px;
            padding: 20px;
            margin-top: 10px;
            page-break-inside: avoid;
          }
          .financial-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 16px;
          }
          .financial-total {
            font-size: 20px;
            font-weight: bold;
            color: ${profit >= 0 ? '#10b981' : '#ef4444'};
            padding-top: 15px;
            border-top: 2px solid ${profit >= 0 ? '#10b981' : '#ef4444'};
            margin-top: 15px;
          }
          .status-badge {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            background: ${event.confirmed ? '#10b981' : '#f59e0b'};
            color: white;
          }
          .description-box {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
            margin-top: 10px;
            page-break-inside: avoid;
          }
          .footer {
            margin-top: 50px;
            padding-top: 20px;
            border-top: 2px solid #e5e7eb;
            text-align: center;
            color: #666;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🎵 MeuShow</h1>
          <p>Relatório de Evento</p>
        </div>

        <div class="section">
          <div class="section-title">📋 Informações do Evento</div>
          <div class="info-row">
            <div class="info-label">Nome:</div>
            <div class="info-value"><strong>${event.name}</strong></div>
          </div>
          <div class="info-row">
            <div class="info-label">Data:</div>
            <div class="info-value">${formatCalendarDate(event.event_date)}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Horário:</div>
            <div class="info-value">${formatTime(event.start_time)} às ${formatTime(event.end_time)}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Local:</div>
            <div class="info-value">${event.city || 'Não informado'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Contato:</div>
            <div class="info-value">${event.contractor_phone || 'Não informado'}</div>
          </div>
          ${artistName ? `<div class="info-row">
            <div class="info-label">Artista:</div>
            <div class="info-value">${artistName}</div>
          </div>` : ''}
          ${creatorName ? `<div class="info-row">
            <div class="info-label">Criado por:</div>
            <div class="info-value">${creatorName}</div>
          </div>` : ''}
          <div class="info-row">
            <div class="info-label">Status:</div>
            <div class="info-value">
              <span class="status-badge">${event.confirmed ? 'Confirmado' : 'A Confirmar'}</span>
            </div>
          </div>
        </div>

        ${includeFinancials ? `
        <div class="section">
          <div class="section-title">💰 Resumo Financeiro</div>
          <div class="financial-box">
            <div class="financial-row">
              <span>Valor do Evento:</span>
              <strong>${formatCurrency(event.value || 0)}</strong>
            </div>
            <div class="financial-row">
              <span>Total de Despesas:</span>
              <strong>-${formatCurrency(totalExpenses)}</strong>
            </div>
            <div class="financial-row financial-total">
              <span>Lucro Líquido:</span>
              <span>${formatCurrency(profit)}</span>
            </div>
            <div style="text-align: center; margin-top: 15px; font-weight: bold; color: ${profit >= 0 ? '#10b981' : '#ef4444'};">
              Resultado: ${profit >= 0 ? 'POSITIVO ✅' : 'NEGATIVO ❌'}
            </div>
          </div>
        </div>
        ` : `
        <div class="section">
          <div class="section-title">🔒 Informações Financeiras</div>
          <div class="financial-box">
            <p style="margin: 0; text-align: center;">Os valores financeiros foram omitidos conforme solicitado.</p>
          </div>
        </div>
        `}

        ${event.description ? `
        <div class="section">
          <div class="section-title">📝 Descrição</div>
          <div class="description-box">
            ${event.description}
          </div>
        </div>
        ` : ''}

        <div class="footer">
          <p><strong>Sistema: MeuShow - Gestão de Shows e Eventos</strong></p>
          <p>Relatório gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>
          <p>${includeFinancials ? '💰 Com valores financeiros' : '🔒 Sem valores financeiros'}</p>
        </div>
      </body>
    </html>
    `;

    try {
      // Gerar PDF usando expo-print com timeout
      console.log('📄 Gerando PDF...');
      
      // Promise com timeout de 30 segundos
      const generatePDFWithTimeout = () => {
        return Promise.race([
          Print.printToFileAsync({ 
            html: htmlContent,
            base64: false,
            width: 612, // Letter size width in points
            height: 792 // Letter size height in points
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: PDF generation took too long')), 30000)
          )
        ]);
      };
      
      const { uri } = await generatePDFWithTimeout();
      
      console.log('✅ PDF gerado:', uri);

      // Verificar se compartilhamento está disponível
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (!isAvailable) {
        // Fallback: copiar conteúdo em texto
        Alert.alert(
          'Compartilhamento não disponível',
          'Deseja copiar o relatório em texto?',
          [
            {
              text: 'Copiar',
              onPress: async () => {
                const textContent = `
🎵 MeuShow - RELATÓRIO DE EVENTO

📋 INFORMAÇÕES DO EVENTO
Nome: ${event.name}
Data: ${formatCalendarDate(event.event_date)}
Horário: ${formatTime(event.start_time)} às ${formatTime(event.end_time)}
Local: ${event.city || 'Não informado'}
Contato: ${event.contractor_phone || 'Não informado'}
${artistName ? `Artista: ${artistName}` : ''}
${creatorName ? `Criado por: ${creatorName}` : ''}
Status: ${event.confirmed ? '✅ Confirmado' : '⏳ A Confirmar'}

${includeFinancials ? `💰 RESUMO FINANCEIRO
Valor do Evento: ${formatCurrency(event.value || 0)}
Total de Despesas: -${formatCurrency(totalExpenses)}
Lucro Líquido: ${formatCurrency(profit)} ${profit >= 0 ? '✅' : '❌'}
${profit >= 0 ? 'Resultado: POSITIVO' : 'Resultado: NEGATIVO'}` : '🔒 Valores financeiros omitidos'}

${event.description ? `📝 DESCRIÇÃO\n${event.description}` : ''}

📱 Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
                `.trim();
                
                await Clipboard.setStringAsync(textContent);
                Alert.alert('Sucesso', 'Relatório copiado para a área de transferência!');
              }
            },
            { text: 'Cancelar', style: 'cancel' }
          ]
        );
        return { success: true };
      }

      // Mover PDF para um local acessível
      const fileName = `Evento_${event.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().getTime()}.pdf`;
      const newUri = FileSystem.documentDirectory + fileName;
      
      await FileSystem.moveAsync({
        from: uri,
        to: newUri
      });

      console.log('📤 Compartilhando PDF:', newUri);

      // Compartilhar PDF via sistema nativo (WhatsApp, Email, etc)
      await Sharing.shareAsync(newUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Compartilhar Relatório do Evento',
        UTI: 'com.adobe.pdf'
      });

      return { success: true };
    } catch (pdfError) {
      console.error('Erro ao gerar/compartilhar PDF:', pdfError);
      
      // Verificar tipo de erro
      const errorMessage = pdfError instanceof Error && pdfError.message.includes('Timeout')
        ? 'A geração do PDF excedeu o tempo limite (30s). O documento pode estar muito grande. Deseja copiar o relatório em texto?'
        : 'Não foi possível gerar o PDF. Deseja copiar o relatório em texto?';
      
      // Fallback: oferecer copiar texto
      Alert.alert(
        'Erro ao gerar PDF',
        errorMessage,
        [
          {
            text: 'Copiar Texto',
            onPress: async () => {
              const textContent = `
🎵 MeuShow - RELATÓRIO DE EVENTO

📋 INFORMAÇÕES DO EVENTO
Nome: ${event.name}
Data: ${formatCalendarDate(event.event_date)}
Horário: ${formatTime(event.start_time)} às ${formatTime(event.end_time)}
Local: ${event.city || 'Não informado'}
Contato: ${event.contractor_phone || 'Não informado'}
${artistName ? `Artista: ${artistName}` : ''}
${creatorName ? `Criado por: ${creatorName}` : ''}
Status: ${event.confirmed ? '✅ Confirmado' : '⏳ A Confirmar'}

${includeFinancials ? `💰 RESUMO FINANCEIRO
Valor do Evento: ${formatCurrency(event.value || 0)}
Total de Despesas: -${formatCurrency(totalExpenses)}
Lucro Líquido: ${formatCurrency(profit)} ${profit >= 0 ? '✅' : '❌'}
${profit >= 0 ? 'Resultado: POSITIVO' : 'Resultado: NEGATIVO'}` : '🔒 Valores financeiros omitidos'}

${event.description ? `📝 DESCRIÇÃO\n${event.description}` : ''}

📱 Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
              `.trim();
              
              try {
                await Clipboard.setStringAsync(textContent);
                Alert.alert('Sucesso', 'Relatório copiado para a área de transferência!');
              } catch {
                Alert.alert('Erro', 'Não foi possível copiar o relatório.');
              }
            }
          },
          { text: 'Cancelar', style: 'cancel' }
        ]
      );
      
      return { success: false, error: 'Erro ao gerar PDF' };
    }
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro desconhecido ao gerar relatório' 
    };
  }
};

// Função para exportar agenda completa em PDF
export const generateAgendaPDF = async (data: AgendaPDFData): Promise<{ success: boolean; error?: string }> => {
  try {
    const { events, month, year, artistName, includeFinancials = true } = data;
    
    // Formatar hora
    const formatTime = (timeString: string) => {
      return timeString.substring(0, 5); // HH:MM
    };
    
    // Formatar moeda sem símbolo
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

    // Ordenar eventos por data
    const sortedEvents = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date));
    
    // Calcular totais
    const totalReceitas = sortedEvents.reduce((sum, event) => sum + (event.value || 0), 0);
    const totalDespesas = sortedEvents.reduce((sum, event) => {
      // Calcular despesas deste evento
      const expensesSum = event.expenses?.reduce((s: number, e: any) => s + (e.value || 0), 0) || 0;
      return sum + expensesSum;
    }, 0);
    const saldoLiquido = totalReceitas - totalDespesas;

    // Criar HTML formatado para o PDF da agenda
    const now = new Date();
    const dataGeracao = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}hs`;
    
    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Helvetica', 'Arial', sans-serif;
            padding: 40px;
            color: #333;
            background: white;
            line-height: 1.5;
          }
          
          .header-section {
            display: flex;
            align-items: flex-start;
            gap: 20px;
            margin-bottom: 20px;
          }
          
          .logo {
            width: 70px;
            height: 70px;
            background: #667eea;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          }
          
          .logo-text {
            font-size: 42px;
            font-weight: bold;
            color: #ffffff;
            line-height: 1;
          }
          
          .header-content {
            flex: 1;
          }
          
          .artist-name {
            font-size: 32px;
            font-weight: bold;
            color: #333;
            margin-bottom: 6px;
            letter-spacing: 0.5px;
            line-height: 1.2;
          }
          
          .report-title {
            font-size: 20px;
            color: #333;
            font-weight: 700;
            margin-bottom: 6px;
          }
          
          .generated-info {
            font-size: 11px;
            color: #666;
            line-height: 1.5;
          }
          
          .header-divider {
            height: 2px;
            background: #333;
            margin: 20px 0 30px 0;
          }
          
          .divider {
            height: 1px;
            background: #e5e7eb;
            margin: 30px 0;
          }
          
          .events-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 40px;
            border: 2px solid #333;
            font-size: 13px;
          }
          
          .events-table thead {
            background: #f3f4f6;
          }
          
          .events-table th {
            padding: 12px;
            text-align: left;
            font-weight: 700;
            font-size: 13px;
            border: 1px solid #333;
            color: #333;
            background: #f3f4f6;
          }
          
          .events-table td {
            padding: 10px 12px;
            border: 1px solid #333;
            font-size: 13px;
            color: #333;
          }
          
          .events-table tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          
          .value-positive {
            color: #333;
            font-weight: 600;
          }
          
          .value-negative {
            color: #333;
            font-weight: 600;
          }
          
          .section-title {
            font-size: 20px;
            font-weight: bold;
            color: #333;
            margin: 40px 0 25px 0;
            padding-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .expense-card {
            background: white;
            padding: 20px 0;
            margin-bottom: 30px;
            page-break-inside: avoid;
          }
          
          .expense-card-title {
            font-size: 15px;
            font-weight: 700;
            color: #333;
            margin-bottom: 15px;
          }
          
          .expense-table {
            width: 100%;
            border-collapse: collapse;
            border: 2px solid #333;
            margin-top: 12px;
          }
          
          .expense-table thead {
            background: #f3f4f6;
          }
          
          .expense-table th {
            padding: 10px;
            text-align: left;
            font-weight: 700;
            font-size: 12px;
            color: #333;
            border: 1px solid #333;
            background: #f3f4f6;
          }
          
          .expense-table td {
            padding: 8px 10px;
            border: 1px solid #333;
            font-size: 13px;
            color: #333;
          }
          
          .expense-table tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          
          .expense-table tr.total-row {
            font-weight: 700;
            background: #f3f4f6;
            border-top: 2px solid #333;
            font-size: 14px;
          }
          
          .expense-label {
            color: #333;
          }
          
          .expense-value {
            text-align: right;
            color: #333;
          }
          
          .summary-section {
            margin-top: 50px;
            padding-top: 30px;
            border-top: 2px solid #d1d5db;
            page-break-inside: avoid;
            page-break-before: auto;
          }
          
          .summary-title {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            text-align: center;
            margin-bottom: 30px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
          }
          
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 20px;
            page-break-inside: avoid;
          }
          
          .summary-item {
            text-align: center;
            padding: 25px 20px;
            border: 2px solid #d1d5db;
            background: white;
            page-break-inside: avoid;
          }
          
          .summary-label {
            font-size: 14px;
            color: #333;
            margin-bottom: 15px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .summary-value {
            font-size: 32px;
            font-weight: bold;
            color: #333;
            line-height: 1.2;
          }
          
          .summary-value.receitas {
            color: #333;
          }
          
          .summary-value.despesas {
            color: #333;
          }
          
          .summary-value.liquido {
            color: #333;
          }
          
          .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
            border: 1px dashed #d1d5db;
            border-radius: 8px;
            background: #f9fafb;
          }
          
          .footer {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #666;
            font-size: 11px;
            line-height: 1.6;
          }
          
          @media print {
            body {
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        <!-- Cabeçalho -->
        <div class="header-section">
          <div class="logo">
            <div class="logo-text">MS</div>
          </div>
          <div class="header-content">
            ${artistName ? `<h1 class="artist-name">${artistName.toUpperCase()}</h1>` : ''}
            <h2 class="report-title">Lista de Eventos - ${months[month]}/${year}</h2>
            <p class="generated-info">
              Relatório gerado: ${dataGeracao} pelo aplicativo MeuShow.
            </p>
          </div>
        </div>
        
        <div class="header-divider"></div>

        ${sortedEvents.length > 0 ? `
          <!-- Tabela de Eventos -->
          <table class="events-table">
            <thead>
              <tr>
                <th style="width: 35%;">Evento</th>
                <th style="width: 15%;">Data</th>
                ${includeFinancials ? `
                <th style="width: 15%; text-align: right;">Valor (R$)</th>
                <th style="width: 15%; text-align: right;">Despesas (R$)</th>
                <th style="width: 20%; text-align: right;">Líquido (R$)</th>
                ` : `
                <th style="width: 20%;">Horário</th>
                <th style="width: 30%;">Local</th>
                `}
              </tr>
            </thead>
            <tbody>
              ${sortedEvents.map(event => {
                const eventExpenses = event.expenses?.reduce((s: number, e: any) => s + (e.value || 0), 0) || 0;
                const liquido = (event.value || 0) - eventExpenses;
                
                return `
                <tr>
                  <td><strong>${event.name}</strong></td>
                  <td>${formatCalendarDate(event.event_date)}</td>
                  ${includeFinancials ? `
                  <td style="text-align: right;">${formatNumber(event.value || 0)}</td>
                  <td style="text-align: right;">${formatNumber(eventExpenses)}</td>
                  <td style="text-align: right;">
                    ${formatNumber(liquido)}
                  </td>
                  ` : `
                  <td>${formatTime(event.start_time)} - ${formatTime(event.end_time)}</td>
                  <td>${event.city || 'Não informado'}</td>
                  `}
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          ${includeFinancials ? `
          <!-- Detalhamento de Despesas -->
          <h3 class="section-title">DETALHAMENTO DE DESPESAS</h3>
          
          ${sortedEvents.filter(event => event.expenses && event.expenses.length > 0).map(event => {
            const totalEventExpenses = event.expenses?.reduce((s: number, e: any) => s + (e.value || 0), 0) || 0;
            
            return `
            <div class="expense-card">
              <div class="expense-card-title">
                Evento: ${event.name} - ${formatCalendarDate(event.event_date)}
              </div>
              <table class="expense-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th style="text-align: right;">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${(event.expenses || []).map((expense: any) => `
                    <tr>
                      <td class="expense-label">${expense.name}</td>
                      <td class="expense-value">R$ ${formatNumber(expense.value)}</td>
                    </tr>
                  `).join('')}
                  <tr class="total-row">
                    <td class="expense-label">Total</td>
                    <td class="expense-value">R$ ${formatNumber(totalEventExpenses)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            `;
          }).join('')}

          ${sortedEvents.filter(event => !event.expenses || event.expenses.length === 0).length > 0 ? `
            <p style="text-align: center; color: #666; padding: 20px; font-style: italic;">
              ${sortedEvents.filter(event => event.expenses && event.expenses.length > 0).length === 0 
                ? 'Nenhum evento possui despesas registradas.' 
                : 'Alguns eventos não possuem despesas registradas.'}
            </p>
          ` : ''}

          <!-- Resumo Financeiro -->
          <div class="summary-section">
            <div class="summary-title">RESUMO FINANCEIRO</div>
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-label">Receitas</div>
                <div class="summary-value receitas">R$ ${formatNumber(totalReceitas)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Despesas</div>
                <div class="summary-value despesas">R$ ${formatNumber(totalDespesas)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Saldo Líquido</div>
                <div class="summary-value liquido">R$ ${formatNumber(saldoLiquido)}</div>
              </div>
            </div>
          </div>
          ` : ''}
        ` : `
        <div class="empty-state">
          <p style="font-size: 48px; margin: 0;">📅</p>
          <p style="font-size: 18px; margin: 20px 0 10px;">Nenhum evento encontrado</p>
          <p>Não há eventos programados para este período.</p>
        </div>
        `}

        <div class="footer">
          <p>MeuShow - Gestão Profissional de Shows e Eventos</p>
          <p>Documento gerado automaticamente • ${includeFinancials ? 'Relatório Completo' : 'Relatório Sem Valores'}</p>
        </div>
      </body>
    </html>
    `;

    try {
      // Gerar PDF usando expo-print com timeout
      console.log('📄 Gerando agenda em PDF...');
      
      // Promise com timeout de 30 segundos
      const generateAgendaPDFWithTimeout = () => {
        return Promise.race([
          Print.printToFileAsync({ 
            html: htmlContent,
            base64: false,
            width: 612, // Letter size width in points
            height: 792 // Letter size height in points
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: Agenda PDF generation took too long')), 30000)
          )
        ]);
      };
      
      const { uri } = await generateAgendaPDFWithTimeout();
      
      console.log('✅ PDF da agenda gerado:', uri);

      // Verificar se compartilhamento está disponível
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (!isAvailable) {
        Alert.alert(
          'Compartilhamento não disponível',
          'Não foi possível compartilhar o PDF neste dispositivo.'
        );
        return { success: false, error: 'Compartilhamento não disponível' };
      }

      // Mover PDF para um local acessível
      const fileName = `Agenda_${months[month]}_${year}_${new Date().getTime()}.pdf`;
      const newUri = FileSystem.documentDirectory + fileName;
      
      await FileSystem.moveAsync({
        from: uri,
        to: newUri
      });

      console.log('📤 Compartilhando PDF da agenda:', newUri);

      // Compartilhar PDF via sistema nativo (WhatsApp, Email, etc)
      await Sharing.shareAsync(newUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Compartilhar Agenda',
        UTI: 'com.adobe.pdf'
      });

      return { success: true };
    } catch (pdfError) {
      console.error('Erro ao gerar/compartilhar PDF da agenda:', pdfError);
      
      const errorMessage = pdfError instanceof Error && pdfError.message.includes('Timeout')
        ? 'A geração do PDF da agenda excedeu o tempo limite (30s). Tente gerar com menos eventos ou sem valores financeiros.'
        : 'Erro ao gerar PDF da agenda';
      
      return { success: false, error: errorMessage };
    }
  } catch (error) {
    console.error('Erro ao gerar agenda:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro desconhecido ao gerar agenda' 
    };
  }
};
