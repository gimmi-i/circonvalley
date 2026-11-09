/**
 * CIRCONVALLEY — Gestione eventi (Google Apps Script)
 *
 * Vive dentro lo Sheet "Sito CVB - Gestione Eventi" (Estensioni → Apps Script).
 * Questo file nel repo è solo una COPIA DI BACKUP: va tenuto allineato.
 *
 * Cosa fa:
 *  - legge locandina e GPX dai link di Google Drive scritti nel tab Eventi;
 *  - dal GPX calcola km, dislivello, il disegno del percorso e il profilo altimetrico;
 *  - come Web App (doGet) dà alla pagina circonvalley.com/eventi/ il prossimo evento.
 *
 * Primo utilizzo: esegui `setup` una volta, poi pubblica come Web App.
 */

const TAB_EVENTI = 'Eventi';
const TAB_LEGGIMI = 'LEGGIMI';

const MAX_PUNTI_MAPPA = 700;   // punti massimi del percorso semplificato
const PUNTI_PROFILO = 200;     // punti del profilo altimetrico
const SOGLIA_DISLIVELLO = 4;   // metri: le oscillazioni più piccole del GPS non contano

// Le prime 16 colonne si compilano a mano, le altre le scrive lo script.
// Non inserire colonne in mezzo.
const HEADERS_EVENTI = ['Nome', 'Data', 'Ora ritrovo', 'Ora partenza', 'Luogo ritrovo', 'Link Google Maps',
  'Descrizione', 'Descrizione EN', 'Bici', 'Bici EN', 'Link Instagram', 'Link Strava', 'Link WhatsApp',
  'Locandina (link Drive)', 'GPX (link Drive)', 'Visibile',
  'Stato', 'ID locandina', 'ID GPX', 'Km calcolati', 'Dislivello calcolato', 'Ultima lettura', 'Percorso', 'Profilo'];
const N_MANUALI_EVENTI = 16;
const E = {};
HEADERS_EVENTI.forEach((h, i) => { E[h] = i; });

// Accetta i vari formati di link di Drive (…/d/ID/…, ?id=ID) o il solo ID
function idDaLink(v) {
  const s = String(v || '').trim();
  const m = s.match(/\/d\/([-\w]{10,})/) || s.match(/[?&]id=([-\w]{10,})/) || s.match(/^([-\w]{10,})$/);
  return m ? m[1] : '';
}

const giornoEvento = (r, tz) => Object.prototype.toString.call(r[E['Data']]) === '[object Date]' && !isNaN(r[E['Data']])
  ? Utilities.formatDate(r[E['Data']], tz, 'yyyy-MM-dd') : '';

// Legge locandina e GPX delle righe dove il link è cambiato. Scrive solo le colonne grigie.
function aggiornaEventi(opts) {
  opts = opts || {};
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB_EVENTI);
  if (!sh) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(opts.attesa || 0)) return;
  try {
    const last = sh.getLastRow();
    if (last < 2) return;
    const range = sh.getRange(2, 1, last - 1, HEADERS_EVENTI.length);
    const righe = range.getValues();
    const prima = JSON.stringify(righe.map(r => r.slice(N_MANUALI_EVENTI)));
    const tz = ss.getSpreadsheetTimeZone();

    righe.forEach(r => {
      if (!String(r[E['Nome']]).trim() && !r[E['Data']]) return;   // riga vuota
      const errori = [];

      const idLocandina = idDaLink(r[E['Locandina (link Drive)']]);
      if (idLocandina !== r[E['ID locandina']]) {
        try {
          if (idLocandina) rendiScaricabile(DriveApp.getFileById(idLocandina));
          r[E['ID locandina']] = idLocandina;
        } catch (err) { r[E['ID locandina']] = ''; }
      }
      if (String(r[E['Locandina (link Drive)']]).trim() && !r[E['ID locandina']]) errori.push('locandina');

      const idGpx = idDaLink(r[E['GPX (link Drive)']]);
      try {
        if (!idGpx) {
          ['ID GPX', 'Km calcolati', 'Dislivello calcolato', 'Ultima lettura', 'Percorso', 'Profilo'].forEach(h => { r[E[h]] = ''; });
        } else if (idGpx !== r[E['ID GPX']] || !r[E['Percorso']] || opts.controllaDrive) {
          const f = DriveApp.getFileById(idGpx);
          const letto = r[E['Ultima lettura']];
          if (idGpx !== r[E['ID GPX']] || !r[E['Percorso']] || !letto || new Date(letto) < f.getLastUpdated()) {
            const a = analizzaGpx(f.getBlob().getDataAsString('UTF-8'));
            r[E['ID GPX']] = idGpx;
            r[E['Km calcolati']] = a.km;
            r[E['Dislivello calcolato']] = a.dislivello;
            r[E['Percorso']] = a.percorso;
            r[E['Profilo']] = a.profilo;
            r[E['Ultima lettura']] = new Date();
            rendiScaricabile(f);
          }
        }
      } catch (err) {
        r[E['ID GPX']] = r[E['Percorso']] = r[E['Profilo']] = '';
        errori.push('GPX');
      }

      r[E['Stato']] = statoEvento(r, tz, errori);
    });

    if (JSON.stringify(righe.map(r => r.slice(N_MANUALI_EVENTI))) !== prima) {
      sh.getRange(2, N_MANUALI_EVENTI + 1, righe.length, HEADERS_EVENTI.length - N_MANUALI_EVENTI)
        .setValues(righe.map(r => r.slice(N_MANUALI_EVENTI)));
    }
  } finally {
    lock.releaseLock();
  }
}

function statoEvento(r, tz, errori) {
  if (errori.length) return 'Controlla il link: ' + errori.join(' e ') + ' non leggibile';
  if (!String(r[E['Nome']]).trim()) return 'Manca il nome';
  const giorno = giornoEvento(r, tz);
  if (!giorno) return 'Data non valida';
  if (r[E['Visibile']] !== true) return 'Nascosto';
  if (giorno < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) return 'Passato';
  return 'Ok';
}

function leggiProssimoEvento() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB_EVENTI);
  if (!sh) return null;
  aggiornaEventi();   // un link appena incollato viene letto subito
  const last = sh.getLastRow();
  if (last < 2) return null;
  const range = sh.getRange(2, 1, last - 1, HEADERS_EVENTI.length);
  const testi = range.getDisplayValues();   // gli orari come li vede chi compila lo Sheet
  const tz = ss.getSpreadsheetTimeZone();
  const oggi = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const prossimo = range.getValues()
    .map((r, i) => ({ r: r, testo: testi[i], giorno: giornoEvento(r, tz) }))
    .filter(x => x.r[E['Visibile']] === true && String(x.r[E['Nome']]).trim() && x.giorno >= oggi)
    .sort((a, b) => a.giorno < b.giorno ? -1 : a.giorno > b.giorno ? 1 : 0)[0];
  if (!prossimo) return null;

  const r = prossimo.r;
  const t = h => String(r[E[h]]).trim();
  const ora = h => { const m = String(prossimo.testo[E[h]]).match(/(\d{1,2})[:.](\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
  const idLoc = t('ID locandina'), idGpx = t('ID GPX');
  const nome = t('Nome');
  return {
    id: nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento',
    nome: nome,
    data: prossimo.giorno,
    oraRitrovo: ora('Ora ritrovo'),
    oraPartenza: ora('Ora partenza'),
    luogo: t('Luogo ritrovo'),
    mappa: t('Link Google Maps'),
    descrizione: t('Descrizione'),
    descrizioneEn: t('Descrizione EN'),
    bici: t('Bici'),
    biciEn: t('Bici EN'),
    instagram: t('Link Instagram'),
    strava: t('Link Strava'),
    whatsapp: t('Link WhatsApp'),
    locandina: idLoc ? 'https://lh3.googleusercontent.com/d/' + idLoc + '=w1600' : '',
    locandinaRiserva: idLoc ? 'https://drive.google.com/thumbnail?id=' + idLoc + '&sz=w1600' : '',
    gpx: idGpx ? 'https://drive.google.com/uc?export=download&id=' + idGpx : '',
    km: Number(r[E['Km calcolati']]) || 0,
    dislivello: Math.round(Number(r[E['Dislivello calcolato']]) || 0),
    percorso: t('Percorso'),
    profilo: t('Profilo'),
  };
}

// ───────────── SETUP (eseguire una volta) ─────────────
// Crea il tab con già il primo evento (mancano solo i link di locandina e GPX)
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Europe/Rome');
  if (!ss.getSheetByName(TAB_EVENTI)) {
    const sh = ss.insertSheet(TAB_EVENTI, 0);
    sh.getRange(1, 1, 1, HEADERS_EVENTI.length).setValues([HEADERS_EVENTI]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, N_MANUALI_EVENTI + 1, 1, HEADERS_EVENTI.length - N_MANUALI_EVENTI)
      .setBackground('#eeeeee').setFontColor('#777777');
    sh.getRange(2, E['Data'] + 1, sh.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(2, E['Ora ritrovo'] + 1, sh.getMaxRows() - 1, 2).setNumberFormat('@');
    [240, 100, 100, 100, 180, 200, 380, 380, 260, 260, 200, 200, 200, 240, 240, 80, 230, 120, 120, 100, 130, 140, 90, 90]
      .forEach((w, i) => sh.setColumnWidth(i + 1, w));

    const riga = new Array(N_MANUALI_EVENTI).fill('');
    riga[E['Nome']] = 'Introduzione alla salita - volume 2';
    riga[E['Data']] = new Date(2026, 10, 14, 12);   // mezzogiorno: resta il 14 in qualunque fuso orario
    riga[E['Ora ritrovo']] = '10:30';
    riga[E['Ora partenza']] = '11:00';
    riga[E['Luogo ritrovo']] = 'Stazione di Lecco';
    riga[E['Link Google Maps']] = 'https://share.google/JpbDV6A1SphSIagW6';
    riga[E['Descrizione']] = 'Descrizione in arrivo.';
    riga[E['Descrizione EN']] = 'Description coming soon.';
    riga[E['Bici']] = 'Consigliata bici da strada (ma tutte le bici sono ben accette)';
    riga[E['Bici EN']] = 'Road bike recommended (but all bikes are welcome)';
    riga[E['Link Instagram']] = 'https://www.instagram.com/circonvalley.bikes/';
    riga[E['Link Strava']] = 'https://www.strava.com/clubs/518848';
    riga[E['Link WhatsApp']] = 'https://chat.whatsapp.com/DAn84rEZnjz1ABdLgQcvUB?mode=gi_t';
    riga[E['Visibile']] = true;
    sh.getRange(2, 1, 1, N_MANUALI_EVENTI).setValues([riga]);
    sh.getRange(2, E['Visibile'] + 1, sh.getMaxRows() - 1, 1).insertCheckboxes();
    sh.getRange(2, E['Visibile'] + 1).setValue(true);
  }
  creaLeggimi();

  // Il foglio vuoto iniziale non serve
  ss.getSheets().forEach(f => {
    if (f.getName() !== TAB_EVENTI && f.getName() !== TAB_LEGGIMI && f.getLastRow() === 0) ss.deleteSheet(f);
  });

  // Controllo automatico dei file su Drive, una volta all'ora
  const giaCreato = ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === 'aggiornaEventiOgniOra');
  if (!giaCreato) ScriptApp.newTrigger('aggiornaEventiOgniOra').timeBased().everyHours(1).create();
  ss.toast('Fatto: ora puoi compilare il tab Eventi', 'Eventi', 8);
}

function aggiornaEventiOgniOra() {
  aggiornaEventi({ attesa: 30000, controllaDrive: true });
}

function aggiornaEventiDaMenu() {
  aggiornaEventiOgniOra();
  SpreadsheetApp.getActive().toast('Eventi aggiornati: guarda la colonna Stato', 'Eventi', 8);
}

// Il link "↓ GPX" funziona solo se il file è condiviso con chiunque abbia il link
function rendiScaricabile(f) {
  try {
    if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK &&
        f.getSharingAccess() !== DriveApp.Access.ANYONE) {
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (err) {
    console.warn('Condivisione non modificata per ' + f.getName() + ': ' + err);
  }
}

// ───────────── ANALISI DEL GPX ─────────────
function analizzaGpx(xml) {
  let pts = leggiPunti(xml, 'trkpt');
  if (pts.length < 2) pts = leggiPunti(xml, 'rtept');
  if (pts.length < 2) throw new Error('Nessun punto nel GPX');

  // distanza progressiva in metri
  pts[0].d = 0;
  for (let i = 1; i < pts.length; i++) pts[i].d = pts[i - 1].d + distanza(pts[i - 1], pts[i]);
  const totale = pts[pts.length - 1].d;

  // dislivello positivo, ignorando le oscillazioni sotto soglia
  let salita = 0, rif = null;
  pts.forEach(p => {
    if (p.e === null) return;
    if (rif === null) { rif = p.e; return; }
    if (p.e - rif >= SOGLIA_DISLIVELLO) { salita += p.e - rif; rif = p.e; }
    else if (rif - p.e >= SOGLIA_DISLIVELLO) rif = p.e;
  });

  // percorso semplificato per la mappa
  let tolleranza = 4, semplice = semplifica(pts, tolleranza);
  while (semplice.length > MAX_PUNTI_MAPPA) { tolleranza *= 1.6; semplice = semplifica(pts, tolleranza); }

  // profilo: punti a distanza regolare (km, quota, lat, lon)
  let profilo = '';
  if (pts.some(p => p.e !== null)) {
    const campioni = [];
    let j = 0;
    for (let k = 0; k < PUNTI_PROFILO; k++) {
      const obiettivo = totale * k / (PUNTI_PROFILO - 1);
      while (j < pts.length - 1 && pts[j + 1].d <= obiettivo) j++;
      let q = j;
      while (q > 0 && pts[q].e === null) q--;
      if (pts[q].e === null) continue;
      campioni.push([(pts[j].d / 1000).toFixed(2), Math.round(pts[q].e), pts[j].lat.toFixed(5), pts[j].lon.toFixed(5)].join(','));
    }
    profilo = campioni.join(';');
  }

  return {
    km: Math.round(totale / 100) / 10,
    dislivello: Math.round(salita),
    percorso: codificaPolyline(semplice),
    profilo: profilo,
  };
}

function leggiPunti(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const lat = /\blat\s*=\s*["']([-+\d.eE]+)["']/.exec(m[1]);
    const lon = /\blon\s*=\s*["']([-+\d.eE]+)["']/.exec(m[1]);
    if (!lat || !lon) continue;
    const ele = m[2] ? /<(?:\w+:)?ele>\s*([-+\d.eE]+)\s*</.exec(m[2]) : null;
    out.push({ lat: Number(lat[1]), lon: Number(lon[1]), e: ele ? Number(ele[1]) : null });
  }
  return out;
}

function distanza(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Douglas-Peucker (tolleranza in metri)
function semplifica(pts, tol) {
  const lat0 = pts[0].lat * Math.PI / 180;
  const xy = pts.map(p => [p.lon * Math.cos(lat0) * 111320, p.lat * 110540]);
  const tieni = new Uint8Array(pts.length);
  tieni[0] = tieni[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    let max = 0, idx = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > max) { max = d2; idx = i; }
    }
    if (idx >= 0 && max > tol * tol) { tieni[idx] = 1; pila.push([a, idx], [idx, b]); }
  }
  return pts.filter((p, i) => tieni[i]);
}

// Formato "encoded polyline" di Google, precisione 5 decimali
function codificaPolyline(pts) {
  let out = '', pLat = 0, pLon = 0;
  const enc = v => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  pts.forEach(p => {
    const lat = Math.round(p.lat * 1e5), lon = Math.round(p.lon * 1e5);
    out += enc(lat - pLat) + enc(lon - pLon);
    pLat = lat; pLon = lon;
  });
  return out;
}

// ───────────── WEB APP ─────────────
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ evento: leggiProssimoEvento() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ───────────── MENU E GUIDA ─────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Eventi')
    .addItem('Aggiorna sito', 'aggiornaEventiDaMenu')
    .addItem('Aggiorna il tab LEGGIMI', 'creaLeggimi')
    .addToUi();
}

function creaLeggimi() {
  const ss = SpreadsheetApp.getActive();
  const s = ss.getSheetByName(TAB_LEGGIMI) || ss.insertSheet(TAB_LEGGIMI);
  s.clear();
  const righe = [
    ['GESTIONE EVENTI — come funziona'],
    [''],
    ['COSA COMPARE SUL SITO'],
    ['Il sito mostra solo il prossimo evento: la riga con Visibile spuntato e la data più vicina, a partire da oggi. Il giorno dopo la data sparisce da solo.'],
    ['Se non c\'è nessun evento, il sito dice che il prossimo è in arrivo.'],
    [''],
    ['AGGIUNGERE UN EVENTO'],
    ['1. Aggiungi una riga nel tab Eventi. Nome e Data sono obbligatori; tutto quello che lasci vuoto non compare sul sito.'],
    ['2. Carica locandina e GPX su Google Drive. Tasto destro sul file → Condividi → Copia link, e incolla il link nella colonna giusta.'],
    ['3. Spunta Visibile. Km, dislivello, mappa e profilo si calcolano dal GPX.'],
    ['Per cambiare locandina o GPX basta incollare il link del file nuovo.'],
    [''],
    ['LE COLONNE'],
    ['Ora ritrovo e Ora partenza: scrivile come 10:30.'],
    ['Descrizione EN e Bici EN: per il sito in inglese. Se sono vuote, lì compare il testo in italiano.'],
    ['Le colonne grigie (da Stato in poi) le scrive lo script: non modificarle.'],
    ['Stato: Ok se è tutto a posto. Se dice "Controlla il link", il file non si riesce ad aprire: deve essere su Drive di thecirconvalley o condiviso con lei.'],
    ['Non inserire colonne in mezzo alla tabella.'],
  ];
  s.getRange(1, 1, righe.length, 1).setValues(righe);
  s.setColumnWidth(1, 900);
  s.getRange('A1').setFontWeight('bold').setFontSize(14);
  righe.forEach((r, i) => { if (i > 0 && r[0] && r[0] === r[0].toUpperCase()) s.getRange(i + 1, 1).setFontWeight('bold'); });
}
