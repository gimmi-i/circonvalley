/**
 * CIRCONVALLEY — Backend preorder (Google Apps Script)
 * Pagamento con PayPal o bonifico: lo script raccoglie solo gli ordini.
 * Al primo utilizzo esegui la funzione `setup`.
 */

const TAB_SETTINGS = 'Impostazioni';
const TAB_PRODUCTS = 'Prodotti';
const TAB_ORDERS   = 'Ordini';
const ORDER_HEADERS = ['Data', 'Codice ordine', 'Pagato', 'Nome', 'Email', 'Prodotto', 'Taglia',
  'Manica', 'Tasche gambe', 'Tasca schiena', 'Prezzo €', 'Totale ordine €', 'Metodo', 'Note'];

// ───────────── SETUP (eseguire una volta) ─────────────
function setup() {
  const ss = SpreadsheetApp.getActive();

  const s = ss.getSheetByName(TAB_SETTINGS) || ss.insertSheet(TAB_SETTINGS);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 4, 3).setValues([
      ['Impostazione', 'Valore', 'Spiegazione'],
      ['preorder_aperto', false, 'Spunta per aprire il preorder, togli la spunta per chiuderlo'],
      ['data_apertura', '', 'Solo informativa, mostrata sul sito quando è chiuso'],
      ['data_chiusura', '', 'Se è una data, il preorder si chiude da solo a fine giornata'],
    ]);
    s.getRange('B2').insertCheckboxes();
    s.getRange('A1:C1').setFontWeight('bold');
    s.setColumnWidth(1, 160); s.setColumnWidth(2, 200); s.setColumnWidth(3, 460);
  }

  const p = ss.getSheetByName(TAB_PRODUCTS) || ss.insertSheet(TAB_PRODUCTS);
  if (p.getLastRow() === 0) {
    p.getRange(1, 1, 6, 3).setValues([
      ['id', 'Nome', 'Prezzo €'],
      ['aerosuit', 'Aerosuit', 85],
      ['summer-jersey', 'Summer Jersey', 30],
      ['autumn-jersey', 'Autumn Jersey', 60],
      ['mtb-tshirt', 'MTB T-Shirt', 20],
      ['summer-bibs', 'Summer Bibs', 45],
    ]);
    p.getRange('A1:C1').setFontWeight('bold');
  }

  const o = ss.getSheetByName(TAB_ORDERS) || ss.insertSheet(TAB_ORDERS);
  if (o.getLastRow() === 0) {
    o.appendRow(ORDER_HEADERS);
    o.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight('bold');
    o.setFrozenRows(1);
    o.getRange('C2:C1000').insertCheckboxes();
  }
}

// ───────────── HELPERS ─────────────
function getSettings() {
  const rows = SpreadsheetApp.getActive().getSheetByName(TAB_SETTINGS).getDataRange().getValues();
  const out = {};
  rows.slice(1).forEach(r => out[r[0]] = r[1]);
  return out;
}
function fmtDate(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'Europe/Rome', 'd/M/yyyy') : (v ? String(v) : '');
}
function isOpen(st) {
  if (st.preorder_aperto !== true) return false;
  if (st.data_chiusura instanceof Date) {
    const end = new Date(st.data_chiusura); end.setHours(23, 59, 59);
    if (new Date() > end) return false;
  }
  return true;
}
function getPrices() {
  const rows = SpreadsheetApp.getActive().getSheetByName(TAB_PRODUCTS).getDataRange().getValues();
  const out = {};
  rows.slice(1).forEach(r => { if (r[0]) out[r[0]] = { name: r[1], price: Number(r[2]) }; });
  return out;
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
const yesNo = v => v === 'si' ? 'Sì' : v === 'no' ? 'No' : '';
const manica = v => v === 'corta' ? 'Corta' : v === 'lunga' ? 'Lunga' : '';

// ───────────── API ─────────────
function doGet() {
  const st = getSettings();
  return json({ open: isOpen(st), apertura: fmtDate(st.data_apertura),
    chiusura: fmtDate(st.data_chiusura), prices: getPrices() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents);
    if (body.action !== 'order') return json({ error: 'Azione sconosciuta' });

    if (!isOpen(getSettings())) return json({ error: 'Il preorder è chiuso.' });
    const items = body.items || [];
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 150);
    const notes = String(body.notes || '').trim().slice(0, 500);
    const method = body.method === 'bonifico' ? 'Bonifico' : 'PayPal';
    if (!items.length || items.length > 30) return json({ error: 'Carrello non valido' });
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Nome o email non validi' });

    // Prezzi presi dallo Sheet, non dal browser
    const prices = getPrices();
    const lines = items.map(i => {
      const p = prices[i.productId];
      if (!p) throw new Error('Prodotto sconosciuto');
      return { ...i, name: p.name, price: p.price };
    });
    const total = lines.reduce((s, l) => s + l.price, 0);
    const orderId = 'CV' + Utilities.formatDate(new Date(), 'Europe/Rome', 'MMdd') + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_ORDERS);
    const now = new Date();
    const rows = lines.map(l => [now, orderId, false, name, email, l.name, l.taglia,
      manica(l.maniche), yesNo(l.tascheGambe), yesNo(l.tascaSchiena), l.price, total, method, notes]);
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
    sheet.getRange(start, 3, rows.length, 1).insertCheckboxes();

    return json({ orderId, total });
  } catch (err) {
    return json({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}
