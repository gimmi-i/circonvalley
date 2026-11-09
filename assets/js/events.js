/* ==========================================================================
   Events page (eventi/, en/events/): the next event.
   It comes from the "Sito CVB - Gestione Eventi" Google Sheet (Eventi.gs,
   URL in config.js). Anything left empty there is not shown.
   Needs config.js and site.js loaded first.
   ========================================================================== */

(function () {
  'use strict';

  /* Texts written by this script. The fixed texts are in the two HTML pages. */
  const TEXTS = {
    it: {
      locale: 'it-IT',
      meeting: 'Ritrovo', departure: 'Partenza', place: 'Dove', bike: 'Bici', route: 'Percorso',
      climb: 'm d+', start: 'Partenza', finish: 'Arrivo', startFinish: 'Partenza e arrivo',
      downloadGpx: '↓ Scarica il GPX', poster: 'Locandina di ',
      loadError: 'Non riusciamo a caricare l’evento in questo momento. Riprova tra poco.',
      mapHelp: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + rotellina per ingrandire la mappa',
        'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + rotellina per ingrandire la mappa',
        'CooperativeGesturesHandler.MobileHelpText': 'Usa due dita per spostare la mappa',
        'NavigationControl.ZoomIn': 'Ingrandisci',
        'NavigationControl.ZoomOut': 'Rimpicciolisci',
      },
    },
    en: {
      locale: 'en-GB',
      meeting: 'Meet at', departure: 'Start time', place: 'Where', bike: 'Bike', route: 'Route',
      climb: 'm climbing', start: 'Start', finish: 'Finish', startFinish: 'Start and finish',
      downloadGpx: '↓ Download the GPX', poster: 'Poster of ',
      loadError: 'We can’t load the event right now. Try again in a moment.',
      mapHelp: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + scroll to zoom the map',
        'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + scroll to zoom the map',
        'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move the map',
        'NavigationControl.ZoomIn': 'Zoom in',
        'NavigationControl.ZoomOut': 'Zoom out',
      },
    },
  };
  const T = TEXTS[Site.lang];

  const MAPLIBRE_URL = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl';
  const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const LOOP_DISTANCE_M = 300;    // start and finish closer than this = one marker only
  const PROFILE_SMOOTHING = 1.5;  // same as the Tracce page. NOTE: decimals with a DOT
  const PROFILE_W = 1000, PROFILE_H = 150, PROFILE_TOP = 22;
  const ROUTE_COLOR = '#e10600';  // brand red

  const CACHE_KEY = 'cvb:next-event';
  const $ = id => document.getElementById(id);
  const isWebLink = s => /^https:\/\//.test(s || '');
  const formatNumber = (n, decimals) => Number(n).toLocaleString(T.locale, { maximumFractionDigits: decimals || 0 });
  // Today in Milano, as "2026-11-14"
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

  /* The Apps Script answers in Italian field names; this is the only place that knows them */
  function normalizeEvent(raw) {
    return {
      id: raw.id,
      name: raw.nome,
      date: raw.data,
      meetingTime: raw.oraRitrovo || '',
      departureTime: raw.oraPartenza || '',
      place: raw.luogo || '',
      mapsLink: raw.mappa || '',
      description: Site.inLanguage(raw.descrizione, raw.descrizioneEn) || '',
      bike: Site.inLanguage(raw.bici, raw.biciEn) || '',
      instagram: raw.instagram || '',
      strava: raw.strava || '',
      whatsapp: raw.whatsapp || '',
      poster: raw.locandina || '',
      posterFallback: raw.locandinaRiserva || '',
      gpx: raw.gpx || '',
      km: raw.km || 0,
      climb: raw.dislivello || 0,
      line: decodePolyline(raw.percorso || ''),
      profile: parseProfile(raw.profilo),
    };
  }

  function parseAnswer(text) {
    const data = JSON.parse(text);
    if (!data || !('evento' in data)) throw new Error('Unexpected answer from the Sheet');
    // a saved answer may be about an event that is now over
    return data.evento && data.evento.data >= today() ? normalizeEvent(data.evento) : null;
  }

  /* The last answer is kept in the visitor's browser: the event appears at once,
     then the page quietly asks the Sheet (1–3 s) and redraws only if something changed. */
  function readCache() { try { return localStorage.getItem(CACHE_KEY); } catch (e) { return null; } }
  function writeCache(text) { try { localStorage.setItem(CACHE_KEY, text); } catch (e) { /* no cache */ } }

  async function start() {
    const cached = readCache();
    let shown = false;
    if (cached) {
      try { render(parseAnswer(cached)); shown = true; } catch (e) { /* damaged copy: ignore it */ }
    }
    try {
      const fresh = await (await fetch(EVENTS_API_URL)).text();
      const event = parseAnswer(fresh);   // throws if the answer is not valid
      writeCache(fresh);
      if (fresh !== cached) render(event);
    } catch (err) {
      console.error(err);
      if (!shown) $('event-status').textContent = T.loadError;
    }
  }

  /* ── Page ── */
  function render(event) {
    $('event-status').hidden = true;
    $('event-empty').hidden = !!event;
    $('event').hidden = !event;
    if (!event) return;

    const [y, m, d] = event.date.split('-').map(Number);
    $('event-date').textContent = new Date(y, m - 1, d)
      .toLocaleDateString(T.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('event-name').textContent = event.name;
    document.title = event.name + ' — Circonvalley Bikes';

    renderPoster(event);
    renderFacts(event);
    $('event-desc').textContent = event.description;
    $('event-desc').hidden = !event.description;
    renderLinks(event);
    renderRoute(event);
  }

  function renderPoster(event) {
    const link = $('event-poster'), img = $('event-poster-img');
    link.hidden = !event.poster;
    $('event-top').classList.toggle('no-poster', !event.poster);
    if (!event.poster) return;
    let usedFallback = false;
    img.onerror = () => {
      if (usedFallback || !event.posterFallback) { link.hidden = true; $('event-top').classList.add('no-poster'); return; }
      usedFallback = true;
      img.src = event.posterFallback;
    };
    img.alt = T.poster + event.name;
    img.src = event.poster;
    link.href = event.poster;
  }

  function renderFacts(event) {
    const box = $('event-facts');
    box.textContent = '';
    const add = (label, text, href) => {
      if (!text) return;
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      if (isWebLink(href)) {
        const a = document.createElement('a');
        a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
        dd.appendChild(a);
      } else dd.textContent = text;
      row.append(dt, dd);
      box.appendChild(row);
    };
    add(T.place, event.place, event.mapsLink);
    add(T.meeting, event.meetingTime);
    add(T.departure, event.departureTime);
    add(T.bike, event.bike);
    add(T.route, [event.km ? formatNumber(event.km, 1) + ' km' : '', event.climb ? formatNumber(event.climb) + ' ' + T.climb : ''].filter(Boolean).join(' · '));
  }

  function renderLinks(event) {
    const box = $('event-links');
    box.textContent = '';
    const add = (label, href, external, red) => {
      if (!isWebLink(href)) return;
      const a = document.createElement('a');
      a.className = red ? 'btn btn-red' : 'btn';
      a.href = href;
      a.textContent = label;
      if (external) { a.target = '_blank'; a.rel = 'noopener'; }
      else { a.dataset.countEvent = 'gpx-evento-' + event.id; a.dataset.countTitle = 'GPX evento: ' + event.name; }
      box.appendChild(a);
    };
    add(T.downloadGpx, event.gpx, false, true);
    add('Instagram', event.instagram, true);
    add('Strava', event.strava, true);
    add('WhatsApp', event.whatsapp, true);
    box.hidden = !box.children.length;
  }

  /* ── Route: map and elevation profile ── */
  let currentEvent = null, map = null, hoverMarker = null, endMarkers = [];

  function loadMapLibrary() {
    return new Promise(resolve => {
      if (typeof maplibregl !== 'undefined') return resolve(true);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = MAPLIBRE_URL + '.css';
      const js = document.createElement('script');
      js.src = MAPLIBRE_URL + '.js';
      let pending = 2;
      const done = () => { if (--pending === 0) resolve(typeof maplibregl !== 'undefined'); };
      css.onload = css.onerror = js.onload = js.onerror = done;
      document.head.append(css, js);
    });
  }

  async function renderRoute(event) {
    currentEvent = event;
    const hasRoute = event.line.length > 1;
    drawProfile(event);
    $('event-route').hidden = !hasRoute;
    if (!hasRoute) return;
    if (!(await loadMapLibrary())) { $('map').hidden = true; return; }
    if (currentEvent !== event) return;   // fresher data arrived meanwhile
    if (!map) createMap(); else if (map.getSource('route')) showRouteOnMap();
  }

  function createMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE_URL,
      bounds: boundsOf(currentEvent.line),
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true },
      cooperativeGestures: true,   // the map doesn't steal the page scrolling
      dragRotate: false,
      pitchWithRotate: false,
      locale: T.mapHelp,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');
    map.touchZoomRotate.disableRotation();

    const dot = document.createElement('div');
    dot.className = 'hover-dot';
    hoverMarker = new maplibregl.Marker({ element: dot });

    map.on('style.load', () => {
      recolorMap();
      map.addSource('route', { type: 'geojson', data: routeShape() });
      const round = { 'line-join': 'round', 'line-cap': 'round' };
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': ROUTE_COLOR, 'line-width': 4 } });
      addStartFinish();
    });
  }

  const routeShape = () => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: currentEvent.line } });

  function showRouteOnMap() {
    map.getSource('route').setData(routeShape());
    addStartFinish();
    map.fitBounds(boundsOf(currentEvent.line), { padding: 60, duration: 0 });
  }

  function boundsOf(line) {
    const b = new maplibregl.LngLatBounds();
    line.forEach(p => b.extend(p));
    return b;
  }

  // Same colours as the Tracce map
  function recolorMap() {
    map.getStyle().layers.forEach(l => {
      try {
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f8f7f4');
        else if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#dfe4e6');
        else if (l.type === 'fill' && /park|wood|grass|landcover/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#ebeee4');
      } catch (e) { /* unexpected style: leave it as it is */ }
    });
  }

  function addStartFinish() {
    endMarkers.forEach(m => m.remove());
    const line = currentEvent.line;
    const a = line[0], b = line[line.length - 1];
    const loop = new maplibregl.LngLat(a[0], a[1]).distanceTo(new maplibregl.LngLat(b[0], b[1])) < LOOP_DISTANCE_M;
    const centre = boundsOf(line).getCenter().lng;
    const marker = (cls, text, point) => {
      const left = point[0] > centre;   // the label points towards the middle of the route
      const el = document.createElement('div');
      el.className = 'pin ' + cls + (left ? ' pin--left' : '');
      el.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${text}</span>`;
      return new maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? 8 : -8, 0] }).setLngLat(point).addTo(map);
    };
    endMarkers = loop ? [marker('pin-start', T.startFinish, a)] : [marker('pin-end', T.finish, b), marker('pin-start', T.start, a)];
  }

  // "Encoded polyline" format (prepared by the Sheet script) → [[lon, lat], …]
  function decodePolyline(str) {
    const out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, v = 0;
        do { b = str.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = (v & 1) ? ~(v >> 1) : (v >> 1);
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lon / 1e5, lat / 1e5]);
    }
    return out;
  }

  // Profile from the Sheet: "km,elevation,lat,lon;…", smoothed as on the Tracce page
  function parseProfile(text) {
    if (!text) return [];
    const points = String(text).split(';').map(s => {
      const [km, ele, lat, lon] = s.split(',').map(Number);
      return { km, ele, lat, lon };
    }).filter(p => !isNaN(p.ele));
    const r = Math.ceil(PROFILE_SMOOTHING * 3);
    return points.map((q, i) => {
      let sum = 0, total = 0;
      for (let k = -r; k <= r; k++) {
        if (i + k < 0 || i + k >= points.length) continue;
        const weight = Math.exp(-(k * k) / (2 * PROFILE_SMOOTHING * PROFILE_SMOOTHING));
        sum += points[i + k].ele * weight;
        total += weight;
      }
      return { ...q, ele: sum / total };
    });
  }

  function drawProfile(event) {
    const p = event.profile;
    $('profile').hidden = p.length < 2;
    if (p.length < 2) return;
    const kmMax = p[p.length - 1].km || 1;
    let min = Math.min(...p.map(q => q.ele)), max = Math.max(...p.map(q => q.ele));
    if (max - min < 100) { const mid = (max + min) / 2; min = mid - 50; max = mid + 50; }   // flat rides don't look like mountains
    const x = km => km / kmMax * PROFILE_W;
    const y = ele => PROFILE_TOP + (1 - (ele - min) / (max - min)) * (PROFILE_H - PROFILE_TOP - 4);
    const line = p.map((q, i) => (i ? 'L' : 'M') + x(q.km).toFixed(1) + ' ' + y(q.ele).toFixed(1)).join(' ');
    $('profile-svg').setAttribute('viewBox', `0 0 ${PROFILE_W} ${PROFILE_H}`);
    $('profile-svg').innerHTML = `
      <path d="${line} L ${PROFILE_W} ${PROFILE_H} L 0 ${PROFILE_H} Z" fill="${ROUTE_COLOR}" fill-opacity="0.14"/>
      <path d="${line}" fill="none" stroke="${ROUTE_COLOR}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      <line id="profile-cursor" x1="0" x2="0" y1="0" y2="${PROFILE_H}" stroke="#111" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
  }

  // Hovering the profile shows km and elevation, and a dot on the matching point of the map
  function onProfile(ev) {
    const p = currentEvent ? currentEvent.profile : [];
    if (p.length < 2) return;
    const r = $('profile-svg').getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const kmMax = p[p.length - 1].km;
    let q = p[0];
    for (const c of p) if (Math.abs(c.km - f * kmMax) < Math.abs(q.km - f * kmMax)) q = c;
    const cursor = $('profile-cursor');
    const cx = q.km / kmMax * PROFILE_W;
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    const label = $('profile-label');
    label.hidden = false;
    label.textContent = `${formatNumber(q.km, 1)} km · ${formatNumber(q.ele)} m`;
    label.style.left = Math.max(55, Math.min(r.width - 55, f * r.width)) + 'px';
    if (hoverMarker && map && !isNaN(q.lat)) hoverMarker.setLngLat([q.lon, q.lat]).addTo(map);
  }
  function offProfile() {
    const cursor = $('profile-cursor');
    if (cursor) cursor.setAttribute('visibility', 'hidden');
    $('profile-label').hidden = true;
    if (hoverMarker) hoverMarker.remove();
  }
  $('profile').addEventListener('pointermove', onProfile);
  $('profile').addEventListener('pointerdown', onProfile);
  $('profile').addEventListener('pointerleave', offProfile);

  start();
})();
