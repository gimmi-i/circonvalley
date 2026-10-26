/**
 * CIRCONVALLEY — Backend preorder (Google Apps Script)
 * Pagamento con PayPal o bonifico: lo script raccoglie solo gli ordini.
 * Al primo utilizzo esegui la funzione `setup`.
 */

const TAB_SETTINGS = 'Impostazioni';
const TAB_PRODUCTS = 'Prodotti';
const TAB_ORDERS   = 'Ordini';
const ORDER_HEADERS = ['Data', 'Codice ordine', 'Pagato', 'Nome', 'Email', 'Prodotto', 'Taglia',
  'Manica', 'Tasche gambe', 'Tasca schiena', 'Prezzo €', 'Totale ordine €', 'Metodo', 'Note',
  'Consegna', 'Spedizione €', 'Indirizzo / dettagli consegna', 'Telefono'];

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
    p.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]).setFontWeight('bold');
    p.setFrozenRows(1);
  }

  const o = ss.getSheetByName(TAB_ORDERS) || ss.insertSheet(TAB_ORDERS);
  if (o.getLastRow() === 0) {
    o.appendRow(ORDER_HEADERS);
    o.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight('bold');
    o.setFrozenRows(1);
  }
}

// ───────────── CATALOGO ─────────────
const PRODUCT_HEADERS = ['id', 'Nome', 'Prezzo €', 'Descrizione', 'Foto', 'Opzioni', 'Visibile'];
const VALID_OPTIONS = ['maniche', 'tasche-gambe', 'tasca-schiena'];

// Catalogo che c'era nel sito prima di spostarlo nello Sheet (usato una volta sola)
const CATALOGO_INIZIALE = {
  'aerosuit':      { nome: 'Aerosuit V2',   foto: 'BodyV2_01.jpg, BodyV2_02.jpg, BodyV2_TabellaTaglie.jpg', opzioni: 'maniche, tasche-gambe, tasca-schiena', visibile: true,  prezzo: 85 },
  'summer-jersey': { nome: 'Summer Jersey', foto: 'jersey_gravel.jpg', opzioni: '', visibile: false, prezzo: 30 },
  'autumn-jersey': { nome: 'Autumn Jersey', foto: 'JerseyAutunno_Fronte.jpg, JerseyAutunno_Retro.jpg', opzioni: '', visibile: true, prezzo: 60 },
  'mtb-tshirt':    { nome: 'MTB T-Shirt',   foto: 'MagliaMTB_Fronte.jpg, MagliaMTB_Retro.jpg, MagliaMTB_03.jpg', opzioni: '', visibile: true, prezzo: 20 },
  'summer-bibs':   { nome: 'Summer Bibs',   foto: 'bibs.jpg', opzioni: 'tasche-gambe', visibile: false, prezzo: 45 },
};

function upgradeProducts() {
  const p = SpreadsheetApp.getActive().getSheetByName(TAB_PRODUCTS);
  const head = p.getRange(1, 1, 1, PRODUCT_HEADERS.length).getValues()[0];
  if (head[4] === 'Foto') return;                       // già migrato
  p.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]).setFontWeight('bold');
  const last = p.getLastRow();
  const ids = last > 1 ? p.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
  ids.forEach((id, i) => {
    const c = CATALOGO_INIZIALE[id];
    if (!c) return;
    p.getRange(i + 2, 2).setValue(c.nome);
    p.getRange(i + 2, 5, 1, 3).setValues([[c.foto, c.opzioni, c.visibile]]);
  });
  // prodotti del sito che mancavano nello Sheet
  Object.keys(CATALOGO_INIZIALE).filter(id => ids.indexOf(id) < 0).forEach(id => {
    const c = CATALOGO_INIZIALE[id];
    p.appendRow([id, c.nome, c.prezzo, '', c.foto, c.opzioni, c.visibile]);
  });
  const n = p.getLastRow() - 1;
  if (n > 0) p.getRange(2, 7, n, 1).insertCheckboxes();
  p.setFrozenRows(1);
}

// Tutti i prodotti dello Sheet, nell'ordine delle righe
function getProducts() {
  const rows = SpreadsheetApp.getActive().getSheetByName(TAB_PRODUCTS).getDataRange().getValues();
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  return rows.slice(1).filter(r => String(r[0]).trim()).map(r => ({
    id: String(r[0]).trim(),
    name: String(r[1] || r[0]).trim(),
    price: Number(r[2]) || 0,
    descrizione: String(r[3] || '').trim(),
    images: split(r[4]),
    options: ['taglia'].concat(split(r[5]).map(o => o.toLowerCase()).filter(o => VALID_OPTIONS.indexOf(o) >= 0)),
    visible: r[6] !== false && String(r[6]).toUpperCase() !== 'FALSE',
  }));
}

// ───────────── HELPERS ─────────────
// Aggiunge da solo ciò che manca negli Sheet creati con versioni precedenti
const SETTINGS_EXTRA = [
  ['costo_spedizione_italia', 6, 'Costo in € della spedizione in Italia'],
  ['costo_spedizione_ue', 11, 'Costo in € della spedizione nel resto dell\'Unione Europea. Fuori UE: da concordare via email'],
  ['info_consegna_mano', '', 'Messaggio mostrato a chi ordina, nell\'avviso prima del checkout (date, luogo, orari della consegna a mano). Ctrl/Cmd+Invio per andare a capo'],
  ['paypal_me', 'andrevita', 'Nome PayPal.me (la parte dopo paypal.me/)'],
  ['iban', 'IT41N0366901600067012785558', 'IBAN per i bonifici'],
  ['intestatario', 'Andrea Franceso Vitali', 'Intestatario del conto'],
  ['email_riepilogo', true, 'Spunta per mandare in automatico l\'email di riepilogo a chi ordina'],
];
function upgrade() {
  const ss = SpreadsheetApp.getActive();
  const s = ss.getSheetByName(TAB_SETTINGS);
  let keys = s.getRange(1, 1, s.getLastRow(), 1).getValues().map(r => r[0]);
  // la vecchia tariffa unica è sostituita da Italia / UE
  const old = keys.indexOf('costo_spedizione');
  if (old >= 0) { s.deleteRow(old + 1); keys = s.getRange(1, 1, s.getLastRow(), 1).getValues().map(r => r[0]); }
  SETTINGS_EXTRA.forEach(row => {
    if (keys.indexOf(row[0]) >= 0) return;
    s.appendRow(row);
    if (typeof row[1] === 'boolean') s.getRange(s.getLastRow(), 2).insertCheckboxes().setValue(row[1]);
  });
  const o = ss.getSheetByName(TAB_ORDERS);
  const head = o.getRange(1, 1, 1, ORDER_HEADERS.length).getValues()[0];
  if (head.some((h, i) => !h)) {
    o.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]).setFontWeight('bold');
  }
}
// Prima riga libera guardando la colonna "Codice ordine" (le caselle vuote non contano)
function firstEmptyOrderRow(sheet) {
  const n = sheet.getMaxRows();
  const codes = sheet.getRange(1, 2, n, 1).getValues();
  let last = 1;
  for (let i = codes.length - 1; i >= 0; i--) { if (codes[i][0] !== '') { last = i + 1; break; } }
  return last + 1;
}
function shippingCosts(st) {
  const num = (v, d) => (v === '' || v == null || !isFinite(Number(v))) ? d : Number(v);
  return { italia: num(st.costo_spedizione_italia, 6), ue: num(st.costo_spedizione_ue, 11) };
}
function paymentInfo(st) {
  return { paypalMe: String(st.paypal_me || '').trim(), iban: String(st.iban || '').trim(), intestatario: String(st.intestatario || '').trim() };
}

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
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
const yesNo = v => v === 'si' ? 'Sì' : v === 'no' ? 'No' : '';
const manica = v => v === 'corta' ? 'Corta' : v === 'lunga' ? 'Lunga' : '';

// ───────────── API ─────────────
function doGet() {
  upgrade();
  upgradeProducts();
  const st = getSettings();
  return json({ open: isOpen(st), apertura: fmtDate(st.data_apertura),
    chiusura: fmtDate(st.data_chiusura), spedizioni: shippingCosts(st), pagamenti: paymentInfo(st),
    products: getProducts().filter(p => p.visible).map(p => { delete p.visible; return p; }),
    // compatibilità con la versione precedente della pagina negozio
    prices: getProducts().reduce((o, p) => { o[p.id] = { name: p.name, price: p.price, descrizione: p.descrizione }; return o; }, {}),
    infoConsegnaMano: String(st.info_consegna_mano || '').trim() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents);
    if (body.action !== 'order') return json({ error: 'Azione sconosciuta' });

    upgrade();
    const st = getSettings();
    if (!isOpen(st)) return json({ error: 'Il preorder è chiuso.' });
    const items = body.items || [];
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 150);
    const notes = String(body.notes || '').trim().slice(0, 500);
    const method = body.method === 'bonifico' ? 'Bonifico' : 'PayPal';
    if (!items.length || items.length > 30) return json({ error: 'Carrello non valido' });
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Nome o email non validi' });

    const dv = body.delivery || {};
    const clip = (x, n) => String(x || '').trim().slice(0, n);
    const zone = dv.method === 'spedizione' ? 'italia' : dv.method;   // compatibilità pagina vecchia
    const costs = shippingCosts(st);
    const ZONES = {
      italia: { label: 'Spedizione Italia', cost: costs.italia },
      ue:     { label: 'Spedizione UE', cost: costs.ue },
      extra:  { label: 'Spedizione extra UE (da concordare)', cost: 0 },
    };
    let delivery;
    if (ZONES[zone]) {
      const country = zone === 'italia' ? 'Italia' : clip(dv.country, 60);
      delivery = { zone, label: ZONES[zone].label, cost: ZONES[zone].cost,
        info: dv.address ? clip(dv.address, 300) + (country ? ', ' + country : '') : '', phone: clip(dv.phone, 40), country };
      if (!dv.address || !delivery.phone || !country) return json({ error: 'Compila i dati della consegna' });
    } else {
      delivery = { zone: 'mano', label: 'A mano', cost: 0, info: clip(dv.note, 500), phone: '' };
      if (!delivery.info) return json({ error: 'Compila i dati della consegna' });
    }

    // Prezzi presi dallo Sheet, non dal browser
    const catalog = {};
    getProducts().forEach(p => { if (p.visible) catalog[p.id] = p; });
    const lines = items.map(i => {
      const p = catalog[i.productId];
      if (!p) throw new Error('Prodotto non disponibile: ricarica la pagina');
      return { ...i, name: p.name, price: p.price };
    });
    const total = lines.reduce((s, l) => s + l.price, 0) + delivery.cost;
    const orderId = 'CV' + Utilities.formatDate(new Date(), 'Europe/Rome', 'MMdd') + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_ORDERS);
    const now = new Date();
    const rows = lines.map(l => [now, orderId, false, name, email, l.name, l.taglia,
      manica(l.maniche), yesNo(l.tascheGambe), yesNo(l.tascaSchiena), l.price, total, method, notes,
      delivery.label, delivery.cost, delivery.info, delivery.phone]);
    const start = firstEmptyOrderRow(sheet);
    sheet.getRange(start, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
    sheet.getRange(start, 3, rows.length, 1).insertCheckboxes();

    // Email di riepilogo (se fallisce, l'ordine resta comunque registrato)
    let emailSent = false;
    if (st.email_riepilogo !== false) {
      try {
        sendRecap({ orderId, name, email, lines, delivery, total, method, notes, st });
        emailSent = true;
      } catch (err) { console.warn('Email non inviata: ' + err.message); }
    }

    return json({ orderId, total, emailSent, extraUe: delivery.zone === 'extra' });
  } catch (err) {
    return json({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ───────────── EMAIL DI RIEPILOGO ─────────────
// Parte dall'account proprietario dello script (thecirconvalley@gmail.com).
// Il testo dell'avviso qui sotto è lo stesso mostrato sul sito prima del checkout.
const AVVISO_PREORDER = [
  ['Questo è un preorder, non un negozio.', 'Il merch non è ancora stato prodotto: lo ordiniamo ai produttori solo dopo la chiusura del preorder, in base a quello che avete ordinato.'],
  ['Tempi:', 'di solito servono circa 6 settimane dalla data di chiusura del preorder perché i capi siano pronti per la consegna.'],
  ['Non ci guadagniamo nulla.', 'Non è una vendita: stiamo solo raccogliendo i soldi di tutti per poter inviare un unico ordine ai produttori.'],
];
const PRIVACY_TESTO = 'Usiamo nome ed email per gestire il tuo ordine e scriverti se serve. Se scegli la spedizione, usiamo indirizzo e telefono solo per spedirti il pacco: li vede solo il corriere. Non vendiamo né condividiamo i tuoi dati con nessun altro e non li usiamo per newsletter o pubblicità. Cancelliamo email, indirizzo e telefono quando tutte le consegne del preorder sono finite. Per vederli, correggerli o farli cancellare prima, rispondi a questa email.';
const EMAIL_COLLETTIVO = 'thecirconvalley@gmail.com';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendRecap(o) {
  const st = o.st, pay = paymentInfo(st), extra = o.delivery.zone === 'extra';
  const eur = n => '€' + n;
  const details = l => ['Taglia ' + l.taglia, l.maniche && 'Manica ' + manica(l.maniche),
    l.tascheGambe && 'Tasche gambe ' + yesNo(l.tascheGambe), l.tascaSchiena && 'Tasca schiena ' + yesNo(l.tascaSchiena)].filter(Boolean).join(' · ');
  const info = String(st.info_consegna_mano || '').trim();
  const P = 'style="margin:0 0 12px;line-height:1.5"';
  const h = [];
  h.push('<div style="font-family:Georgia,serif;font-size:16px;color:#111;max-width:560px">');
  h.push('<p ' + P + '>Ciao ' + esc(o.name) + ',</p>');
  h.push('<p ' + P + '>grazie per il tuo preorder! Questo è il riepilogo. <strong>L\'ordine è valido solo dopo il pagamento.</strong></p>');
  h.push('<p ' + P + '>Codice ordine: <strong style="font-size:18px">' + esc(o.orderId) + '</strong></p>');

  h.push('<table style="border-collapse:collapse;width:100%;margin:8px 0 16px">');
  o.lines.forEach(l => h.push('<tr><td style="padding:8px 0;border-bottom:1px solid #ddd"><strong>' + esc(l.name) + '</strong><br><span style="color:#666;font-size:14px">' + esc(details(l)) + '</span></td><td style="padding:8px 0;border-bottom:1px solid #ddd;text-align:right;vertical-align:top">' + eur(l.price) + '</td></tr>'));
  h.push('<tr><td style="padding:8px 0;border-bottom:1px solid #ddd">' + esc(o.delivery.label) + '</td><td style="padding:8px 0;border-bottom:1px solid #ddd;text-align:right">' + (extra ? 'da concordare' : eur(o.delivery.cost)) + '</td></tr>');
  h.push('<tr><td style="padding:10px 0"><strong>Totale' + (extra ? ' (spedizione esclusa)' : '') + '</strong></td><td style="padding:10px 0;text-align:right;color:#e10600;font-size:20px"><strong>' + eur(o.total) + '</strong></td></tr>');
  h.push('</table>');

  h.push('<p ' + P + '><strong>Consegna:</strong> ' + esc(o.delivery.label) + '<br>' + esc(o.delivery.info) + (o.delivery.phone ? '<br>Tel. ' + esc(o.delivery.phone) : '') + '</p>');
  if (o.notes) h.push('<p ' + P + '><strong>Le tue note:</strong> ' + esc(o.notes) + '</p>');

  // Pagamento
  h.push('<div style="background:#f6f4ef;border-left:3px solid #e10600;padding:12px 16px;margin:16px 0">');
  if (extra) {
    h.push('<p ' + P + '><strong>Prima di pagare, scrivici!</strong> Per le spedizioni fuori dall\'Unione Europea il costo va concordato: rispondi a questa email o scrivi a <a href="mailto:' + EMAIL_COLLETTIVO + '">' + EMAIL_COLLETTIVO + '</a> indicando il codice ' + esc(o.orderId) + '. Ti diremo il totale con la spedizione.</p>');
  }
  if (o.method === 'PayPal') {
    const link = 'https://paypal.me/' + encodeURIComponent(pay.paypalMe) + (extra ? '' : '/' + o.total + 'EUR');
    h.push('<p ' + P + '><strong>Pagamento con PayPal</strong><br><a href="' + link + '">' + esc(link.replace('https://', '')) + '</a><br>Nel messaggio del pagamento scrivi il codice <strong>' + esc(o.orderId) + '</strong>.</p>');
  } else {
    h.push('<p ' + P + '><strong>Pagamento con bonifico</strong><br>Intestatario: ' + esc(pay.intestatario) + '<br>IBAN: <strong>' + esc(pay.iban) + '</strong><br>Importo: ' + (extra ? 'da concordare' : eur(o.total)) + '<br>Causale: <strong>' + esc(o.orderId) + '</strong></p>');
  }
  h.push('</div>');

  // Avvisi
  h.push('<p style="margin:20px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:#666">Da sapere</p>');
  AVVISO_PREORDER.forEach(a => h.push('<p ' + P + '><strong>' + esc(a[0]) + '</strong> ' + esc(a[1]) + '</p>'));
  if (o.delivery.zone === 'mano' && info) h.push('<p ' + P + '><strong>Consegna a mano:</strong><br>' + esc(info).replace(/\n/g, '<br>') + '</p>');
  h.push('<p style="margin:20px 0 0;font-size:13px;color:#666;line-height:1.5"><strong>Privacy.</strong> ' + esc(PRIVACY_TESTO) + '</p>');
  h.push('<p style="margin:20px 0 0">A presto in sella,<br>Circonvalley Bikes</p>');
  h.push('</div>');

  // Versione solo testo
  const t = [];
  t.push('Ciao ' + o.name + ',', '', 'grazie per il tuo preorder! L\'ordine è valido solo dopo il pagamento.', '', 'Codice ordine: ' + o.orderId, '');
  o.lines.forEach(l => t.push('- ' + l.name + ' (' + details(l) + ') ' + eur(l.price)));
  t.push('- ' + o.delivery.label + ' ' + (extra ? 'da concordare' : eur(o.delivery.cost)), 'Totale' + (extra ? ' (spedizione esclusa)' : '') + ': ' + eur(o.total), '');
  t.push('Consegna: ' + o.delivery.info + (o.delivery.phone ? ' - Tel. ' + o.delivery.phone : ''), '');
  if (extra) t.push('PRIMA DI PAGARE scrivici a ' + EMAIL_COLLETTIVO + ' per concordare la spedizione fuori UE.', '');
  if (o.method === 'PayPal') t.push('Pagamento PayPal: https://paypal.me/' + pay.paypalMe + (extra ? '' : '/' + o.total + 'EUR'), 'Nel messaggio scrivi il codice ' + o.orderId);
  else t.push('Bonifico a ' + pay.intestatario, 'IBAN ' + pay.iban, 'Causale ' + o.orderId);
  t.push('');
  AVVISO_PREORDER.forEach(a => t.push(a[0] + ' ' + a[1]));
  if (o.delivery.zone === 'mano' && info) t.push('', 'Consegna a mano: ' + info);
  t.push('', 'Privacy: ' + PRIVACY_TESTO, '', 'Circonvalley Bikes');

  MailApp.sendEmail({
    to: o.email,
    subject: 'Il tuo preorder Circonvalley — ' + o.orderId,
    body: t.join('\n'),
    htmlBody: h.join(''),
    name: 'Circonvalley Bikes',
    replyTo: EMAIL_COLLETTIVO,
  });
}

// Prova: manda un'email di esempio al tuo indirizzo. Eseguila una volta dall'editor
// (serve anche per dare allo script il permesso di inviare email).
function provaEmail() {
  const st = getSettings();
  const me = Session.getEffectiveUser().getEmail();
  sendRecap({ orderId: 'CV0000-PROVA', name: 'Prova', email: me, notes: 'Questa è solo una prova',
    lines: [{ name: 'Aerosuit V2', price: 85, taglia: 'M', maniche: 'corta', tascheGambe: 'si', tascaSchiena: 'no' }],
    delivery: { zone: 'mano', label: 'A mano', cost: 0, info: 'Vengo all\'uscita di giovedì', phone: '' },
    total: 85, method: 'Bonifico', st });
  // avviso che sparisce da solo (una finestra di conferma bloccherebbe l'esecuzione finché non si clicca OK)
  SpreadsheetApp.getActive().toast('Email di prova inviata a ' + me + '. Controlla la posta (anche lo spam).', 'Preorder', 8);
  console.log('Email di prova inviata a ' + me);
}

// ───────────── PRIVACY ─────────────
// Cancella email, indirizzo e telefono dal tab Ordini (restano nome, codice e prodotti).
// Da usare quando le consegne sono finite: menu Preorder → Cancella dati personali.
function cancellaDatiPersonali() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Cancellare i dati personali?',
    'Verranno svuotate le colonne Email, Indirizzo / dettagli consegna e Telefono di TUTTI gli ordini nel tab Ordini. Non si può annullare (salvo con Cronologia versioni). Procedere?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  const o = SpreadsheetApp.getActive().getSheetByName(TAB_ORDERS);
  const n = o.getLastRow() - 1;
  if (n < 1) return;
  [ORDER_HEADERS.indexOf('Email'), ORDER_HEADERS.indexOf('Indirizzo / dettagli consegna'), ORDER_HEADERS.indexOf('Telefono')]
    .forEach(c => o.getRange(2, c + 1, n, 1).clearContent());
  ui.alert('Fatto: dati personali cancellati da ' + n + ' righe.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Preorder')
    .addItem('Cancella dati personali (a consegne finite)', 'cancellaDatiPersonali')
    .addItem('Manda un\'email di prova a me', 'provaEmail')
    .addItem('Aggiorna il tab LEGGIMI', 'creaLeggimi')
    .addToUi();
}

// ───────────── LEGGIMI (eseguire una volta, o di nuovo per aggiornarlo) ─────────────
function creaLeggimi() {
  const T = [
    ['h1', 'LEGGIMI — Come funziona il preorder del merch'],
    ['p',  'Questo Sheet è il "motore" del negozio sul sito (gimmi-i.github.io/circonvalley/merch). Il sito legge da qui se il preorder è aperto, i prezzi e le descrizioni, e scrive qui ogni ordine. I pagamenti NON passano dal sito: chi ordina paga da sé con PayPal o bonifico, e noi segniamo a mano chi ha pagato.'],
    ['', ''],

    ['h2', '🔁 COSA FARE A OGNI PREORDER'],
    ['li', '1. Prima di aprire: controlla prezzi e descrizioni nel tab Prodotti. Cancella (o sposta in un altro file) gli ordini del preorder precedente nel tab Ordini.'],
    ['li', '2. Apertura: tab Impostazioni → scrivi la data_chiusura (es. 25/10/2026) → spunta preorder_aperto. Il sito si aggiorna subito: compaiono il link "Merch" e il banner rosso in homepage.'],
    ['li', '3. Durante la settimana: ogni volta che arriva un pagamento, leggi il codice ordine nella causale del bonifico o nel messaggio PayPal (es. CV1017-AB12). Nel tab Ordini cerca il codice (Ctrl+F / Cmd+F) e spunta la colonna Pagato su TUTTE le righe di quell\'ordine. Controlla che l\'importo ricevuto corrisponda a "Totale ordine €".'],
    ['li', '4. Chiusura: avviene da sola a mezzanotte della data_chiusura. Per chiudere prima, togli la spunta da preorder_aperto.'],
    ['li', '5. Dopo la chiusura: scrivi a chi non ha pagato (email nella colonna Email). Poi Dati → Crea un filtro → colonna Pagato: lascia solo le righe spuntate → usa il filtro sulla colonna Prodotto per contare i pezzi per taglia/opzione da mandare al produttore. Per le consegne: filtra la colonna Consegna su "Spedizione" (indirizzi da spedire) o "A mano" (persone da contattare, con i loro dettagli).'],
    ['li', '6. A consegne finite: menu Preorder → Cancella dati personali (vedi sezione PRIVACY).'],
    ['', ''],

    ['h2', '📑 I TAB DI QUESTO SHEET'],
    ['h3', 'Impostazioni'],
    ['li', 'preorder_aperto — la casella che apre e chiude il negozio.'],
    ['li', 'data_apertura — solo informativa: quando il preorder è chiuso, il sito mostra "Prossima apertura: …". Lasciala vuota se non la sai.'],
    ['li', 'data_chiusura — il giorno in cui il preorder si chiude da solo (a fine giornata). Deve essere una data vera, non testo.'],
    ['li', 'costo_spedizione_italia / costo_spedizione_ue — costo in € della spedizione in Italia e nel resto dell\'UE (es. 6 e 11), aggiunto al totale di chi la sceglie. Per l\'extra UE il sito registra l\'ordine con spedizione "da concordare" e chiede di scrivervi prima di pagare: rispondete con il costo e il totale da pagare.'],
    ['li', 'paypal_me / iban / intestatario — i dati di pagamento mostrati sul sito dopo l\'ordine e nell\'email di riepilogo.'],
    ['li', 'email_riepilogo — se spuntata, ogni ordine riceve in automatico un\'email di riepilogo (prodotti, totale, come pagare, avvisi e privacy) dall\'account proprietario dello Sheet. Le risposte arrivano a thecirconvalley@gmail.com. Limite di Google: circa 100 email al giorno.'],
    ['li', 'info_consegna_mano — il messaggio sulla consegna a mano (date, luogo, orari): compare nell\'avviso "Prima di continuare" sul sito e nell\'email di riepilogo di chi sceglie la consegna a mano. Se è vuoto non compare.'],
    ['h3', 'Prodotti'],
    ['li', 'id — codice interno del prodotto, minuscolo senza spazi (es. winter-gloves). Non cambiarlo durante un preorder: gli ordini in corso lo usano.'],
    ['li', 'Nome — il nome mostrato sul sito e negli ordini.'],
    ['li', 'Prezzo € — il prezzo vero. Si aggiorna da solo sul sito e nei totali degli ordini. Cambialo solo a preorder chiuso, per non avere prezzi diversi nello stesso preorder.'],
    ['li', 'Descrizione — testo mostrato sul sito quando si clicca il prodotto. Per andare a capo nella cella: Ctrl+Invio / Cmd+Invio. Se è vuota non compare nulla.'],
    ['li', 'Foto — nomi dei file nella cartella images/ del sito, separati da virgole (es. BodyV2_01.jpg, BodyV2_02.jpg). La prima è quella del catalogo. Il nome deve essere identico al file, maiuscole comprese.'],
    ['li', 'Opzioni — oltre alla taglia, che c\'è sempre. Scrivi una o più tra: maniche, tasche-gambe, tasca-schiena (separate da virgole). Vuota = solo taglia.'],
    ['li', 'Visibile — spunta per mostrare il prodotto nel negozio, togli la spunta per nasconderlo. L\'ordine delle righe è l\'ordine del catalogo sul sito: per spostare un prodotto, sposta la riga.'],
    ['h3', 'Ordini'],
    ['li', 'Si riempie da solo: UNA RIGA PER OGNI PRODOTTO ordinato. Un ordine con 3 prodotti = 3 righe con lo stesso Codice ordine.'],
    ['li', 'Colonne: Data, Codice ordine, Pagato (da spuntare a mano), Nome, Email, Prodotto, Taglia, Manica, Tasche gambe, Tasca schiena, Prezzo € (del singolo pezzo), Totale ordine € (di tutto l\'ordine, spedizione compresa, ripetuto su ogni riga), Metodo (PayPal/Bonifico), Note del cliente, Consegna (Spedizione / A mano), Spedizione €, Indirizzo / dettagli consegna (indirizzo completo, oppure la nota per la consegna di persona), Telefono.'],
    ['li', 'Non cambiare l\'ordine o i nomi delle colonne e non inserire colonne in mezzo: lo script scrive sempre nelle stesse posizioni. Puoi aggiungere colonne tue DOPO l\'ultima (es. "Consegnato").'],
    ['', ''],

    ['h2', '🌐 IL SITO (GitHub: github.com/gimmi-i/circonvalley)'],
    ['li', 'index.html — la homepage. Il link "Merch" e il banner compaiono solo quando il preorder è aperto.'],
    ['li', 'merch/index.html — la pagina del negozio. I prodotti NON sono più qui: si gestiscono tutti dal tab Prodotti di questo Sheet. Qui c\'è solo il testo dell\'avviso "Prima di continuare" (cerca AVVISO PREORDER) e la nota privacy (cerca PRIVACY).'],
    ['li', 'config.js — indirizzo di questo script (API_URL) e dati di pagamento: nome PayPal.me, IBAN, intestatario. Per cambiare IBAN o PayPal si modifica solo questo file.'],
    ['li', 'images/ — le foto dei prodotti. Tutte QUADRATE (1:1), circa 1600×1600 px, JPG sotto i 600 KB. Se una foto non è quadrata viene tagliata ai bordi.'],
    ['li', 'Code.gs — solo una copia di backup di questo script. Il sito usa quello dentro Estensioni → Apps Script.'],
    ['li', 'Per modificare un file su GitHub: aprilo → matita ✏️ → modifica → Commit changes. Il sito si aggiorna in 1–2 minuti (ricarica con Ctrl+Shift+R).'],
    ['', ''],

    ['h2', '🛠 MODIFICHE FREQUENTI'],
    ['li', 'Nascondere o rimettere un prodotto: tab Prodotti → colonna Visibile.'],
    ['li', 'Aggiungere foto: caricale su GitHub nella cartella images/ (quadrate, ~1600×1600 px, sotto i 600 KB), poi aggiungi i nomi nella colonna Foto del tab Prodotti.'],
    ['li', 'Cambiare una foto senza toccare il codice: carica in images/ un file con lo stesso identico nome (maiuscole comprese).'],
    ['li', 'Aggiungere un prodotto nuovo: aggiungi una riga nel tab Prodotti con id nuovo, nome, prezzo, foto e opzioni, e spunta Visibile (copia la casella da un\'altra riga). Non serve toccare il sito.'],
    ['', ''],

    ['h2', '⚙️ LO SCRIPT (Estensioni → Apps Script)'],
    ['li', 'È il programma che collega sito e Sheet. È pubblicato come "App web": il suo indirizzo è in config.js.'],
    ['li', 'Se modifichi il codice dello script, per pubblicare le modifiche: Esegui il deployment → Gestisci deployment → matita ✏️ → Versione: Nuova versione → Esegui il deployment. NON usare "Nuovo deployment": crea un indirizzo nuovo e il sito smette di funzionare (dovresti aggiornare config.js).'],
    ['li', 'Lo script gira con l\'account che l\'ha pubblicato. Questo Sheet deve restare di proprietà di quell\'account e non va rinominato il tab Impostazioni, Prodotti o Ordini.'],
    ['', ''],

    ['h2', '🔒 PRIVACY'],
    ['li', 'Raccogliamo nome, email e (per la spedizione) indirizzo e telefono. Sul sito, al checkout, c\'è una nota che dice a cosa servono e che li cancelliamo a fine consegne: va rispettata.'],
    ['li', 'Non condividere il tab Ordini con chi non gestisce il preorder. Al produttore mandate solo i conteggi per taglia, mai nomi o indirizzi. Al corriere solo l\'indirizzo di chi ha scelto la spedizione.'],
    ['li', 'Quando TUTTE le consegne sono fatte: menu Preorder (in alto, accanto ad Aiuto) → Cancella dati personali. Svuota email, indirizzi e telefoni da tutte le righe del tab Ordini; restano nome, codice e prodotti per i vostri conti. Nei tab archiviati (es. "Ordini nov 2026") il comando non agisce: lì seleziona e cancella a mano le colonne Email, Indirizzo e Telefono.'],
    ['li', 'Se qualcuno chiede di vedere o cancellare i propri dati, cerca la sua email nel tab Ordini e accontentalo.'],
    ['', ''],

    ['h2', '🆘 SE QUALCOSA NON FUNZIONA'],
    ['li', 'Il sito dice "Preorder chiuso" ma dovrebbe essere aperto → controlla la spunta di preorder_aperto e che data_chiusura non sia già passata.'],
    ['li', 'Il sito dice "Impossibile caricare il negozio" → l\'indirizzo in config.js è sbagliato, oppure lo script è stato ripubblicato con "Nuovo deployment". Prendi l\'URL attuale da Esegui il deployment → Gestisci deployment e mettilo in config.js.'],
    ['li', 'Il catalogo è vuoto o la pagina è bianca dopo una modifica a merch/index.html → quasi sempre manca una virgola o una virgoletta nella riga modificata. Su GitHub apri il file → History per vedere e annullare l\'ultima modifica.'],
    ['li', 'Errore "Prodotto non disponibile" quando qualcuno ordina → il prodotto è stato nascosto o il suo id è cambiato mentre la persona aveva il carrello aperto. Basta ricaricare la pagina.'],
    ['li', 'Un cliente dice di aver ordinato ma non c\'è la riga → l\'ordine non è andato a buon fine (gli sarebbe comparso un messaggio di errore). Chiedigli di riprovare.'],
  ];

  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('LEGGIMI');
  if (sh) sh.clear(); else sh = ss.insertSheet('LEGGIMI', 0);
  ss.setActiveSheet(sh); ss.moveActiveSheet(1);

  sh.getRange(1, 1, T.length, 1).setValues(T.map(r => [r[1]]));
  sh.setColumnWidth(1, 900);
  sh.getRange(1, 1, T.length, 1).setWrap(true).setVerticalAlignment('top').setFontSize(11);
  T.forEach((r, i) => {
    const c = sh.getRange(i + 1, 1);
    if (r[0] === 'h1') c.setFontSize(18).setFontWeight('bold').setFontColor('#e10600');
    if (r[0] === 'h2') c.setFontSize(14).setFontWeight('bold').setBackground('#f3f3f3');
    if (r[0] === 'h3') c.setFontWeight('bold');
  });
  sh.setHiddenGridlines(true);
  if (sh.getMaxColumns() > 1) sh.deleteColumns(2, sh.getMaxColumns() - 1);
  sh.getRange('A1').activate();
}
