/**
 * CSS compartilhado dos PDFs financeiros (expo-print / WebKit).
 * Foco: alinhamento estável, colunas fixas, leitura clara em A4/tela.
 */
export const FINANCIAL_REPORT_HTML_STYLES = `
          @page {
            margin: 14mm 12mm;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          html {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.45;
            color: #1f2937;
            background: #fff;
            padding: 0;
            max-width: 100%;
          }

          /* Cabeçalho: logo em cima, título centralizado */
          .header-section {
            display: block;
            width: 100%;
            text-align: center;
            margin-bottom: 14px;
          }

          .header-section .logo,
          .header-section .header-content {
            display: block;
            width: 100%;
          }

          .logo {
            width: 100%;
            padding: 0;
            margin: 0 0 10px 0;
            text-align: center;
          }

          .logo-inner {
            background: transparent;
            width: auto;
            height: auto;
            box-shadow: none;
            border-radius: 0;
            margin: 0 auto;
          }

          .brand-wordmark {
            height: 52px;
            width: auto;
            display: block;
            margin: 0 auto;
          }

          .logo-text {
            display: none;
          }

          .header-content {
            text-align: center;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          .artist-name {
            font-size: 20px;
            font-weight: 700;
            color: #111827;
            margin: 0 0 4px 0;
            letter-spacing: 0.02em;
            line-height: 1.25;
            text-align: center;
          }

          .report-title {
            font-size: 15px;
            font-weight: 700;
            color: #374151;
            margin: 0 0 6px 0;
            line-height: 1.3;
            text-align: center;
          }

          .generated-info {
            font-size: 10px;
            color: #6b7280;
            line-height: 1.4;
            margin: 0;
            text-align: center;
          }

          .header-divider {
            height: 1px;
            background: #374151;
            margin: 0 0 18px 0;
          }

          .section-title {
            font-size: 13px;
            font-weight: 700;
            color: #111827;
            margin: 22px 0 10px 0;
            padding: 0 0 6px 0;
            border-bottom: 2px solid #374151;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            page-break-after: avoid;
            break-after: avoid;
          }

          .section-title .month-event-meta {
            display: inline-block;
            margin-left: 10px;
            padding: 2px 8px;
            font-size: 10px;
            font-weight: 700;
            color: #4b5563;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            text-transform: none;
            letter-spacing: 0.02em;
            vertical-align: middle;
          }

          .months-wrap .month-block {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e5e7eb;
          }

          .months-wrap .month-block:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
          }

          .months-wrap .month-block:first-child .section-title {
            margin-top: 0;
          }

          .subsection-title {
            font-size: 12px;
            font-weight: 700;
            color: #374151;
            margin: 14px 0 8px 0;
            padding: 0;
            page-break-after: avoid;
            break-after: avoid;
          }

          /* Tabelas */
          .event-table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            border: 1px solid #374151;
            margin: 0 0 16px 0;
            page-break-inside: auto;
          }

          .event-table thead {
            display: table-header-group;
          }

          .event-table tbody {
            display: table-row-group;
          }

          .event-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .event-table th,
          .event-table td {
            padding: 8px 10px;
            border: 1px solid #9ca3af;
            font-size: 11px;
            vertical-align: middle;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          .event-table thead th {
            background: #f3f4f6;
            font-weight: 700;
            color: #111827;
          }

          .event-table tbody tr:nth-child(even) {
            background: #fafafa;
          }

          .event-table tr.total-row td {
            font-weight: 700;
            background: #e5e7eb;
            border-top: 2px solid #374151;
            font-size: 11px;
          }

          .cell-desc {
            text-align: left;
            width: 52%;
          }

          .cell-date {
            text-align: center;
            width: 24%;
          }

          .cell-val {
            text-align: right;
            width: 24%;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }

          /* Tabela 2 colunas (descrição | valor) */
          .event-table.cols-2 .cell-desc {
            width: 62%;
          }

          .event-table.cols-2 .cell-val {
            width: 38%;
          }

          .event-table.cols-2 thead th:first-child {
            text-align: left;
          }

          .event-table.cols-2 thead th:last-child {
            text-align: right;
          }

          /* Tabela 3 colunas (sem valores: nome | data | cidade) */
          .event-table.cols-3-agenda .cell-desc {
            width: 42%;
          }

          .event-table.cols-3-agenda .cell-date {
            width: 30%;
          }

          .event-table.cols-3-agenda .cell-city {
            width: 28%;
            text-align: center;
          }

          .summary-section {
            margin-top: 28px;
            padding-top: 18px;
            border-top: 2px solid #d1d5db;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .summary-title {
            font-size: 13px;
            font-weight: 700;
            color: #111827;
            text-align: center;
            margin: 0 0 14px 0;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            page-break-after: avoid;
          }

          .summary-grid {
            display: table;
            width: 100%;
            table-layout: fixed;
            border-collapse: separate;
            border-spacing: 10px 0;
          }

          .summary-item {
            display: table-cell;
            width: 33.33%;
            vertical-align: middle;
            text-align: center;
            padding: 14px 8px;
            border: 1px solid #9ca3af;
            background: #fff;
            page-break-inside: avoid;
          }

          .summary-label {
            font-size: 9px;
            color: #4b5563;
            margin: 0 0 8px 0;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            line-height: 1.3;
          }

          .summary-value {
            font-size: 15px;
            font-weight: 700;
            color: #111827;
            line-height: 1.25;
            font-variant-numeric: tabular-nums;
            word-break: break-word;
          }

          .event-card {
            margin: 0 0 14px 0;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .event-card-title {
            font-size: 11px;
            font-weight: 700;
            color: #111827;
            margin: 0 0 6px 0;
            line-height: 1.35;
          }

          .empty-state {
            text-align: center;
            padding: 36px 16px;
            color: #6b7280;
            border: 1px dashed #d1d5db;
            border-radius: 6px;
            background: #f9fafb;
            font-size: 12px;
          }

          .empty-month {
            text-align: center;
            padding: 12px 10px;
            color: #6b7280;
            font-size: 11px;
            font-style: italic;
            border: 1px dashed #d1d5db;
            border-radius: 6px;
            background: #f9fafb;
            margin: 0 0 4px 0;
          }

          .footer {
            margin-top: 28px;
            padding-top: 14px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 10px;
            line-height: 1.5;
          }

          .footer p {
            margin: 2px 0;
          }

          @media print {
            body {
              padding: 0;
            }
          }
`;
