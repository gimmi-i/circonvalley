/**
 * CIRCONVALLEY — Gestione tracce (Google Apps Script)
 *
 * Vive dentro lo Sheet "Sito CVB - Gestione Tracce" (Estensioni → Apps Script).
 * Questo file nel repo è solo una COPIA DI BACKUP: va tenuto allineato.
 *
 * Cosa fa:
 *  - guarda la cartella Google Drive dei GPX e aggiunge una riga per ogni file nuovo;
 *  - legge ogni GPX e calcola km, dislivello, il disegno del percorso e il profilo altimetrico;
 *  - come Web App (doGet) dà alla pagina circonvalley.com/tracce/ le tracce visibili.
 *
 * Primo utilizzo: scrivi il link della cartella in Impostazioni ed esegui `setup`.
 */

const TAB_TRACCE = 'Tracce';
const TAB_IMPOSTAZIONI = 'Impostazioni';
const TAB_LEGGIMI = 'LEGGIMI';

// Le prime 7 colonne si compilano a mano, le altre le scrive lo script.
// Non inserire colonne in mezzo.
const HEADERS = ['Nome', 'Descrizione', 'Tipo di bici', 'Km', 'Dislivello m', 'Link Strava', 'Visibile',
  'Stato', 'File GPX', 'ID file', 'Km calcolati', 'Dislivello calcolato', 'Ultima lettura',
  'Percorso', 'Profilo'];
const N_MANUALI = 7;
const PRIMA_COLONNA_SCRIPT = N_MANUALI; // indice 0-based di "Stato"
const C = {};
HEADERS.forEach((h, i) => { C[h] = i; });

const SYNC_MINUTI = 10;        // aprendo la pagina, la cartella si ricontrolla al massimo ogni 10 minuti
const MAX_PUNTI_MAPPA = 700;   // punti massimi del percorso semplificato
const PUNTI_PROFILO = 200;     // punti del profilo altimetrico
const SOGLIA_DISLIVELLO = 4;   // metri: le oscillazioni più piccole del GPS non contano

// ───────────── SETUP (eseguire una volta) ─────────────
function setup() {
  const ss = SpreadsheetApp.getActive();

  const s = ss.getSheetByName(TAB_IMPOSTAZIONI) || ss.insertSheet(TAB_IMPOSTAZIONI);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 2, 3).setValues([
      ['Impostazione', 'Valore', 'Spiegazione'],
      ['cartella_gpx', '', 'Link della cartella Google Drive con i file GPX'],
    ]);
    s.getRange('A1:C1').setFontWeight('bold');
    s.setColumnWidth(1, 160); s.setColumnWidth(2, 380); s.setColumnWidth(3, 380);
  }

  const t = ss.getSheetByName(TAB_TRACCE) || ss.insertSheet(TAB_TRACCE, 0);
  if (t.getLastRow() === 0) {
    t.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    t.setFrozenRows(1);
    t.getRange(1, N_MANUALI + 1, 1, HEADERS.length - N_MANUALI)
      .setBackground('#eeeeee').setFontColor('#777777');
    [180, 380, 110, 70, 100, 200, 80, 230, 200, 120, 100, 130, 140, 90, 90]
      .forEach((w, i) => t.setColumnWidth(i + 1, w));
  }

  creaLeggimi();

  // Controllo automatico della cartella, una volta all'ora
  const giaCreato = ScriptApp.getProjectTriggers()
    .some(tr => tr.getHandlerFunction() === 'aggiornaTracceOgniOra');
  if (!giaCreato) ScriptApp.newTrigger('aggiornaTracceOgniOra').timeBased().everyHours(1).create();

  // Prima lettura: le tracce già presenti partono visibili (oggi sono già sul sito)
  if (cartellaGpx()) {
    const r = aggiornaTracce({ prima: true, attesa: 30000 });
    SpreadsheetApp.getActive().toast(riepilogo(r), 'Tracce', 10);
  } else {
    SpreadsheetApp.getActive().toast('Ora scrivi il link della cartella in Impostazioni e usa Tracce → Aggiorna tracce ora', 'Tracce', 10);
  }
}

// ───────────── IMPOSTAZIONI ─────────────
function impostazioni() {
  const s = SpreadsheetApp.getActive().getSheetByName(TAB_IMPOSTAZIONI);
  const out = {};
  if (!s || s.getLastRow() < 2) return out;
  s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0]) out[String(r[0]).trim()] = r[1]; });
  return out;
}

function cartellaGpx() {
  const v = String(impostazioni().cartella_gpx || '').trim();
  const m = v.match(/folders\/([-\w]{10,})/) || v.match(/[?&]id=([-\w]{10,})/) || v.match(/^([-\w]{10,})$/);
  return m ? DriveApp.getFolderById(m[1]) : null;
}

// ───────────── LETTURA DELLA CARTELLA ─────────────
function aggiornaTracceOgniOra() {
  aggiornaTracce({ attesa: 30000 });
}

function aggiornaTracceDaMenu() {
  const r = aggiornaTracce({ attesa: 30000 });
  SpreadsheetApp.getActive().toast(riepilogo(r), 'Tracce', 8);
}

function riepilogo(r) {
  if (!r) return 'Un altro aggiornamento è in corso: riprova tra poco.';
  return `Nuove: ${r.nuove} · Rilette: ${r.rilette} · File mancanti: ${r.mancanti}` +
    (r.errori ? ` · GPX non leggibili: ${r.errori}` : '');
}

/**
 * Confronta la cartella Drive con il tab Tracce.
 * Scrive SOLO le colonne dello script (da "Stato" in poi) e le righe nuove,
 * così non sovrascrive mai quello che qualcuno sta scrivendo a mano.
 */
function aggiornaTracce(opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(opts.attesa || 0)) return null;
  try {
    const folder = cartellaGpx();
    if (!folder) throw new Error('Manca il link della cartella GPX nel tab Impostazioni');

    const sh = SpreadsheetApp.getActive().getSheetByName(TAB_TRACCE);
    const last = sh.getLastRow();
    const righe = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
    const perId = {};
    righe.forEach((r, i) => { if (r[C['ID file']]) perId[r[C['ID file']]] = i; });

    const visti = {}, nuove = [];
    const esito = { nuove: 0, rilette: 0, mancanti: 0, errori: 0 };
    const files = folder.getFiles();

    while (files.hasNext()) {
      const f = files.next();
      const nomeFile = f.getName();
      if (!/\.gpx$/i.test(nomeFile)) continue;
      const id = f.getId();
      visti[id] = true;

      let r;
      if (perId[id] === undefined) {
        r = new Array(HEADERS.length).fill('');
        r[C['Nome']] = nomeFile.replace(/\.gpx$/i, '').replace(/_+/g, ' ').trim();
        r[C['Visibile']] = !!opts.prima;
        nuove.push(r);
        esito.nuove++;
      } else {
        r = righe[perId[id]];
      }
      r[C['File GPX']] = nomeFile;
      r[C['ID file']] = id;

      const letto = r[C['Ultima lettura']];
      if (!r[C['Percorso']] || !letto || new Date(letto) < f.getLastUpdated()) {
        try {
          const a = analizzaGpx(f.getBlob().getDataAsString('UTF-8'));
          r[C['Km calcolati']] = a.km;
          r[C['Dislivello calcolato']] = a.dislivello;
          r[C['Percorso']] = a.percorso;
          r[C['Profilo']] = a.profilo;
          r[C['Ultima lettura']] = new Date();
          rendiScaricabile(f);
          esito.rilette++;
        } catch (err) {
          r[C['Percorso']] = '';
          r[C['Stato']] = 'GPX non leggibile';
          esito.errori++;
          continue;
        }
      }
      r[C['Stato']] = statoRiga(r);
    }

    righe.forEach(r => {
      if (!r[C['ID file']]) return;
      if (!visti[r[C['ID file']]]) { r[C['Stato']] = 'File mancante (non va sul sito)'; esito.mancanti++; }
      else if (r[C['Stato']] !== 'GPX non leggibile') r[C['Stato']] = statoRiga(r);
    });

    if (righe.length) {
      sh.getRange(2, PRIMA_COLONNA_SCRIPT + 1, righe.length, HEADERS.length - N_MANUALI)
        .setValues(righe.map(r => r.slice(PRIMA_COLONNA_SCRIPT)));
    }
    if (nuove.length) {
      const da = sh.getLastRow() + 1;
      sh.getRange(da, 1, nuove.length, HEADERS.length).setValues(nuove);
      sh.getRange(da, C['Visibile'] + 1, nuove.length, 1).insertCheckboxes();
      sh.getRange(da, C['Percorso'] + 1, nuove.length, 2).setWrap(false);
    }

    menuTipoBici(sh);
    PropertiesService.getScriptProperties().setProperty('ultimoSync', String(Date.now()));
    return esito;
  } finally {
    lock.releaseLock();
  }
}

// Colonna "Tipo di bici" con menu a tendina (prima si chiamava "Terreno")
const TIPI_BICI = ['Fixie', 'Strada', 'Gravel', 'MTB'];
function menuTipoBici(sh) {
  const col = C['Tipo di bici'] + 1;
  if (sh.getRange(1, col).getValue() !== 'Tipo di bici') sh.getRange(1, col).setValue('Tipo di bici');
  const regola = SpreadsheetApp.newDataValidation().requireValueInList(TIPI_BICI, true).setAllowInvalid(true).build();
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regola);
}

function statoRiga(r) {
  const descr = String(r[C['Descrizione']]).trim();
  if (r[C['Visibile']] !== true) return descr ? 'Nascosta' : 'Da completare: scrivi la descrizione e spunta Visibile';
  if (!descr) return 'Sul sito (manca la descrizione)';
  return 'Sul sito';
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
  try {
    const ultimo = Number(PropertiesService.getScriptProperties().getProperty('ultimoSync') || 0);
    if (Date.now() - ultimo > SYNC_MINUTI * 60000) aggiornaTracce({ attesa: 0 });
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput(JSON.stringify({ tracce: leggiTracce() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function leggiTracce() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_TRACCE);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const usati = {};
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .filter(r => r[C['Visibile']] === true && r[C['ID file']] && r[C['Percorso']] &&
      !/^(File mancante|GPX non leggibile)/.test(String(r[C['Stato']])))
    .map(r => {
      const nome = String(r[C['Nome']]).trim() || String(r[C['File GPX']]);
      let slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'traccia';
      while (usati[slug]) slug += '-2';
      usati[slug] = true;
      const num = (manuale, calcolato) => (manuale !== '' && !isNaN(Number(manuale))) ? Number(manuale) : Number(calcolato) || 0;
      return {
        id: slug,
        nome: nome,
        descrizione: String(r[C['Descrizione']]).trim(),
        terreno: String(r[C['Tipo di bici']]).trim(),
        km: num(r[C['Km']], r[C['Km calcolati']]),
        dislivello: Math.round(num(r[C['Dislivello m']], r[C['Dislivello calcolato']])),
        strava: String(r[C['Link Strava']]).trim(),
        gpx: 'https://drive.google.com/uc?export=download&id=' + r[C['ID file']],
        percorso: r[C['Percorso']],
        profilo: r[C['Profilo']],
      };
    });
}

// ───────────── MENU E GUIDA ─────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tracce')
    .addItem('Aggiorna tracce ora', 'aggiornaTracceDaMenu')
    .addItem('Aggiorna il tab LEGGIMI', 'creaLeggimi')
    .addToUi();
}

function creaLeggimi() {
  const ss = SpreadsheetApp.getActive();
  const s = ss.getSheetByName(TAB_LEGGIMI) || ss.insertSheet(TAB_LEGGIMI);
  s.clear();
  const righe = [
    ['GESTIONE TRACCE — come funziona'],
    [''],
    ['AGGIUNGERE UNA TRACCIA'],
    ['1. Carica il file .gpx nella cartella Drive indicata nel tab Impostazioni.'],
    ['2. Entro un\'ora compare da sola una riga nel tab Tracce. Per farla comparire subito: menu Tracce → Aggiorna tracce ora.'],
    ['3. Scrivi la Descrizione, scegli il Tipo di bici, correggi il Nome se serve.'],
    ['4. Spunta Visibile: la traccia va subito sul sito (ricarica la pagina per vederla).'],
    [''],
    ['LE COLONNE'],
    ['Nome: il titolo sul sito. All\'inizio è il nome del file, si può cambiare.'],
    ['Descrizione: una o due righe, in italiano.'],
    ['Tipo di bici: scegli dal menu a tendina Fixie, Strada, Gravel o MTB. Decide il colore della traccia sul sito.'],
    ['Km e Dislivello m: lasciali vuoti per usare quelli calcolati dal GPX. Se scrivi un numero (per esempio quello di Strava), vale il tuo.'],
    ['Link Strava: facoltativo. Se c\'è, sul sito compare "Apri su Strava".'],
    ['Visibile: spunta per mostrare la traccia sul sito.'],
    ['Le colonne grigie (da Stato in poi) le scrive lo script: non modificarle.'],
    ['L\'ordine delle righe è l\'ordine sul sito.'],
    [''],
    ['ALTRE COSE DA SAPERE'],
    ['Per sostituire un GPX: su Drive usa "Gestisci versioni" sul file, oppure carica un file nuovo e nascondi la riga vecchia.'],
    ['Se togli un GPX da Drive la riga resta (con la descrizione) e diventa "File mancante": sul sito non compare.'],
    ['Lo script rende i GPX scaricabili da chiunque abbia il link, serve per il pulsante "↓ GPX".'],
    ['Non inserire colonne in mezzo alla tabella.'],
  ];
  s.getRange(1, 1, righe.length, 1).setValues(righe);
  s.setColumnWidth(1, 900);
  s.getRange('A1').setFontWeight('bold').setFontSize(14);
  ['A3', 'A9', 'A19'].forEach(a => s.getRange(a).setFontWeight('bold'));
}
