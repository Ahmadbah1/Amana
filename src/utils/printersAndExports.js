import * as XLSX from 'xlsx';

const LINE_WIDTH = 32; // imprimante 58 mm
// Table de caractères ESC/POS : 19 = CP858 (Epson, accents français + €).
// Si les accents sortent mal sur votre modèle, essayez 16 (WPC1252) ou 2 (CP850).
const CODE_PAGE = 19;
const BLE_CHUNK = 100; // < MTU BLE
const BLE_DELAY_MS = 30;

const ESC = {
  INIT: '\x1B\x40',
  CODEPAGE: '\x1B\x74' + String.fromCharCode(CODE_PAGE),
  ALIGN_LEFT: '\x1B\x61\x00',
  ALIGN_CENTER: '\x1B\x61\x01',
  BOLD_ON: '\x1B\x45\x01',
  BOLD_OFF: '\x1B\x45\x00',
  CUT_PAPER: '\x1D\x56\x41\x03',
};

const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

// Caractères accentués courants -> octets CP858
const CP858 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88,
  'ë': 0x89, 'è': 0x8A, 'ï': 0x8B, 'î': 0x8C, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'û': 0x96,
  'ù': 0x97, 'ÿ': 0x98, 'Ü': 0x9A, '€': 0xD5, 'À': 0xB7, 'Â': 0xB6, 'Ê': 0xD2, 'Ë': 0xD3,
  'È': 0xD4, 'Î': 0xD7, 'Ï': 0xD8, 'Ô': 0xE2, 'Û': 0xEA, 'Ù': 0xEB, '«': 0xAE, '»': 0xAF,
};

// ---------- utilitaires ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const formatAmount = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const formatDate = (d) => new Date(d || Date.now()).toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ');
// Retire les caractères de contrôle (empêche l'injection de commandes ESC/POS via un nom de boutique)
const clean = (s) => String(s ?? '').replace(/[\x00-\x1F\x7F]/g, ' ').trim();

function wrap(text, width = LINE_WIDTH) {
  const lines = [];
  let line = '';
  for (const word of clean(text).split(/\s+/)) {
    if (!word) continue;
    if ((line + ' ' + word).trim().length > width) {
      if (line) lines.push(line);
      line = word.length > width ? word.slice(0, width) : word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join('\n') + '\n';
}

function encodeText(str) {
  const out = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (CP858[ch] !== undefined) out.push(CP858[ch]);
    else if (/\s/.test(ch)) out.push(0x20);
    else if (ch === '—' || ch === '–') out.push(0x2D);
    else if (ch === '’' || ch === '‘') out.push(0x27);
    else {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out.push(base.length === 1 && base.charCodeAt(0) < 0x80 ? base.charCodeAt(0) : 0x3F);
    }
  }
  return Uint8Array.from(out);
}

// ---------- Bluetooth ----------
export async function connectThermalPrinter(onDisconnect) {
  if (!navigator.bluetooth) {
    throw new Error('Bluetooth non supporté sur ce navigateur (utilisez Chrome sur Android ou ordinateur).');
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_SERVICES,
  });
  device.addEventListener('gattserverdisconnected', () => onDisconnect?.());
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (writable) return { device, characteristic: writable };
  }
  device.gatt.disconnect();
  throw new Error("Aucune caractéristique d'écriture trouvée sur cet appareil.");
}

export async function printViaBluetooth(conn, receipt, store) {
  if (!conn?.characteristic || !conn.device?.gatt?.connected) {
    throw new Error('Imprimante Bluetooth non connectée. Reconnectez-la.');
  }
  const sep = '-'.repeat(LINE_WIDTH) + '\n';
  let text = ESC.INIT + ESC.CODEPAGE + ESC.ALIGN_CENTER + ESC.BOLD_ON;
  text += wrap(store?.name || 'AMANA POS') + ESC.BOLD_OFF + 'REÇU MOBILE MONEY\n' + sep;
  text += ESC.ALIGN_LEFT;
  text += `Date : ${formatDate(receipt.created_at)}\n`;
  text += `Op.  : ${clean(receipt.operator)}\n`;
  text += wrap(`Ref : ${receipt.transaction_ref}`);
  if (receipt.items_summary) text += wrap(`Art. : ${receipt.items_summary}`);
  text += sep + ESC.ALIGN_CENTER + ESC.BOLD_ON;
  text += `TOTAL : ${formatAmount(receipt.amount)} FCFA\n` + ESC.BOLD_OFF;
  text += sep + wrap(store?.receipt_footer || 'Merci !') + '\n\n\n' + ESC.CUT_PAPER;

  const bytes = encodeText(text);
  const c = conn.characteristic;
  const noResponse = c.properties.writeWithoutResponse && typeof c.writeValueWithoutResponse === 'function';
  for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
    const chunk = bytes.slice(i, i + BLE_CHUNK);
    if (noResponse) await c.writeValueWithoutResponse(chunk);
    else await c.writeValue(chunk);
    await sleep(BLE_DELAY_MS);
  }
}

// ---------- Impression navigateur ----------
export function printStandardTicket(receipt, store) {
  const pw = window.open('', '_blank', 'height=500,width=400');
  if (!pw) throw new Error('Autorisez les pop-ups pour imprimer.');
  pw.document.write(`
    <html><head><meta charset="utf-8"><style>
      @page{size:58mm auto;margin:0}
      body{font-family:monospace;width:58mm;margin:0 auto;padding:10px;}
      .c{text-align:center;}.b{font-weight:bold;}.l{border-bottom:1px dashed #000;margin:8px 0;}
    </style></head>
    <body>
      <div class="c b">${escapeHtml(store?.name || 'AMANA')}</div>
      <div class="c" style="font-size:11px;">REÇU MOBILE MONEY</div><div class="l"></div>
      <div style="font-size:11px;">Date: ${escapeHtml(formatDate(receipt.created_at))}<br>Op: ${escapeHtml(receipt.operator)}<br>Réf: ${escapeHtml(receipt.transaction_ref)}<br>${receipt.items_summary ? `Articles: ${escapeHtml(receipt.items_summary)}<br>` : ''}</div>
      <div class="l"></div><div class="c b" style="font-size:15px;">${escapeHtml(formatAmount(receipt.amount))} FCFA</div><div class="l"></div>
      <div class="c" style="font-size:10px;">${escapeHtml(store?.receipt_footer || 'Merci !')}</div>
      <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  pw.document.close();
}

// ---------- Exports ----------
export function exportToExcel(receipts, storeName) {
  const rows = receipts.map((r) => ({
    'Date': new Date(r.created_at).toLocaleString('fr-FR'),
    'Boutique': storeName,
    'Opérateur': r.operator,
    'Articles': r.items_summary || '-',
    'Montant (FCFA)': Number(r.amount),
    'Référence': r.transaction_ref,
    'Statut': r.status,
    'Caissier': r.profiles?.full_name || 'N/A',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Trésorerie');
  const safe = String(storeName || 'boutique').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Amana_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportToPDF(receipts, storeName, totalRevenue) {
  const pw = window.open('', '_blank', 'height=600,width=800');
  if (!pw) throw new Error('Autorisez les pop-ups pour exporter.');
  const rowsHtml = receipts.map((r) => `<tr>
    <td>${escapeHtml(new Date(r.created_at).toLocaleString('fr-FR'))}</td>
    <td>${escapeHtml(r.operator)}</td><td>${escapeHtml(r.items_summary || '-')}</td>
    <td>${escapeHtml(Number(r.amount).toLocaleString('fr-FR'))}</td>
    <td>${escapeHtml(r.transaction_ref)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('');
  pw.document.write(`<html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #ddd;padding:8px;font-size:12px;}th{background:#f4f4f4;}
  </style></head><body>
    <h2>Bilan Financier — ${escapeHtml(storeName)}</h2>
    <p>Chiffre d'Affaires : <strong>${escapeHtml(Number(totalRevenue).toLocaleString('fr-FR'))} FCFA</strong></p>
    <table><thead><tr><th>Date</th><th>Opérateur</th><th>Articles</th><th>Montant</th><th>Réf</th><th>Statut</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></body></html>`);
  pw.document.close();
  setTimeout(() => pw.print(), 500);
}
