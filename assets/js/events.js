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
      meeting: 'Orario di ritrovo:', departure: 'Orario di partenza:', place: 'Luogo di ritrovo:', bike: 'Bici:', route: 'Statistiche percorso:',
      climb: 'm d+', start: 'Partenza', finish: 'Arrivo', startFinish: 'Partenza e arrivo',
      downloadGpx: '↓ GPX', poster: 'Locandina di ',
      styleSimple: 'Semplice', styleDetailed: 'Dettagliata', mapStyle: 'Stile della mappa',
      fullscreenOn: 'Mappa a schermo intero', fullscreenOff: 'Esci dallo schermo intero',
      readAll: 'Tocca per leggere tutto', profile: 'Profilo', profileHelp: 'Mostra il profilo altimetrico',
      closeProfile: 'Chiudi il profilo altimetrico',
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
      meeting: 'Meeting time:', departure: 'Start time:', place: 'Meeting point:', bike: 'Bike:', route: 'Route stats:',
      climb: 'm climbing', start: 'Start', finish: 'Finish', startFinish: 'Start and finish',
      downloadGpx: '↓ GPX', poster: 'Poster of ',
      styleSimple: 'Simple', styleDetailed: 'Detailed', mapStyle: 'Map style',
      fullscreenOn: 'Full screen map', fullscreenOff: 'Exit full screen',
      readAll: 'Tap to read it all', profile: 'Profile', profileHelp: 'Show the elevation profile',
      closeProfile: 'Close the elevation profile',
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
  // The two map styles, same as the Tracce page (the choice is shared with it)
  const MAP_STYLES = [
    { id: 'chiara', label: T.styleSimple,   url: 'https://tiles.openfreemap.org/styles/positron', recolor: true },
    { id: 'strade', label: T.styleDetailed, url: 'https://tiles.openfreemap.org/styles/liberty' },
  ];
  const STYLE_KEY = 'cvb:mapstyle';
  let mapStyle = MAP_STYLES[0];
  try { mapStyle = MAP_STYLES.find(x => x.id === localStorage.getItem(STYLE_KEY)) || MAP_STYLES[0]; } catch (e) { /* no storage: default style */ }
  const ARROW_ICON = 'cvb-direction-arrow';
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
      places: (raw.punti || []).filter(q => q && isFinite(q.lat) && isFinite(q.lon) && q.nome),
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
    add(T.route, routeText(event));
  }

  const routeText = event => [event.km ? formatNumber(event.km, 1) + ' km' : '', event.climb ? formatNumber(event.climb) + ' ' + T.climb : ''].filter(Boolean).join(', ');

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
    fillFullscreenCard();
  }

  function createMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: mapStyle.url,
      bounds: boundsOf(allPoints()),
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true },
      cooperativeGestures: true,   // the map doesn't steal the page scrolling
      dragRotate: false,
      pitchWithRotate: false,
      locale: T.mapHelp,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new MapButtons(), 'bottom-right');
    map.getContainer().appendChild(makeFullscreenCard());
    map.getContainer().appendChild(makeFullscreenProfile());
    map.touchZoomRotate.disableRotation();

    const dot = document.createElement('div');
    dot.className = 'hover-dot';
    hoverMarker = new maplibregl.Marker({ element: dot });

    // fires for the first style and again every time the style is changed (that wipes our layers)
    map.on('style.load', addRouteLayers);

    // Map credits: always closed in the "i" button, as on the Tracce page
    const closeCredits = () => {
      const c = map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
      if (c) { c.classList.remove('maplibregl-compact-show'); c.removeAttribute('open'); }
    };
    map.on('resize', () => setTimeout(closeCredits, 0));
    map.on('load', closeCredits);
  }

  function addRouteLayers() {
    if (mapStyle.recolor) recolorMap();
    map.addSource('route', { type: 'geojson', data: routeShape() });
    const round = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 11 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': ROUTE_COLOR, 'line-width': 7 } });
    // thin white arrows along the route, in the riding direction (same as the Tracce page)
    if (map.hasImage(ARROW_ICON)) map.removeImage(ARROW_ICON);
    map.addImage(ARROW_ICON, drawArrow(), { pixelRatio: 2 });
    map.addLayer({ id: 'route-arrows', type: 'symbol', source: 'route',
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 80,
        'icon-image': ARROW_ICON, 'icon-size': 1,
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
    addStartFinish();
  }

  // Small white arrowhead (›), pointing along the line
  function drawArrow() {
    const n = 14, canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const g = canvas.getContext('2d');
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(4, 3); g.lineTo(9.5, 7); g.lineTo(4, 11);
    g.stroke();
    return g.getImageData(0, 0, n, n);
  }

  function setMapStyle(style) {
    if (style.id === mapStyle.id) return;
    mapStyle = style;
    try { localStorage.setItem(STYLE_KEY, style.id); } catch (e) { /* fine */ }
    map.setStyle(style.url);   // 'style.load' then redraws the route
  }

  /* ── Map style (menu) + full screen buttons, same as the Tracce page ── */
  class MapButtons {
    onAdd() {
      const box = document.createElement('div');
      box.className = 'maplibregl-ctrl maplibregl-ctrl-group map-buttons';

      const layers = document.createElement('button');
      layers.type = 'button'; layers.className = 'map-btn map-btn-style';
      layers.setAttribute('aria-label', T.mapStyle); layers.title = T.mapStyle;
      layers.setAttribute('aria-haspopup', 'true'); layers.setAttribute('aria-expanded', 'false');
      layers.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 7 10 11 17.5 7ZM2.5 10.5 10 14.5l7.5-4M2.5 14 10 18l7.5-4"/></svg>';

      const full = document.createElement('button');
      full.type = 'button'; full.className = 'map-btn map-btn-full';
      full.setAttribute('aria-label', T.fullscreenOn); full.title = T.fullscreenOn;
      full.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path class="ic-enter" d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><path class="ic-exit" d="M7 3v4H3M17 7h-4V3M13 17v-4h4M3 13h4v4"/></svg>';
      full.addEventListener('click', () => setFullscreen(!isFullscreen()));

      const menu = document.createElement('div');
      menu.className = 'map-style-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
      const items = MAP_STYLES.map(st => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = st.label; b.setAttribute('role', 'menuitemradio');
        b.addEventListener('click', () => { setMapStyle(st); close(); });
        return b;
      });
      menu.append(...items);
      const mark = () => items.forEach((b, i) => b.setAttribute('aria-checked', String(MAP_STYLES[i] === mapStyle)));
      const close = () => { menu.hidden = true; layers.setAttribute('aria-expanded', 'false'); };
      layers.addEventListener('click', e => {
        e.stopPropagation();
        mark();
        menu.hidden = !menu.hidden;
        layers.setAttribute('aria-expanded', String(!menu.hidden));
      });
      document.addEventListener('click', e => { if (!box.contains(e.target)) close(); });

      box.append(layers, full, menu);
      this.box = box;
      return box;
    }
    onRemove() { this.box.remove(); }
  }

  /* ── Full screen ── */
  const mapBox = () => $('map');
  let cssFullscreen = false;
  const isFullscreen = () => cssFullscreen || document.fullscreenElement === mapBox();

  function setFullscreen(on) {
    const box = mapBox();
    if (on) {
      if (box.requestFullscreen) box.requestFullscreen().catch(() => setCssFullscreen(true));
      else setCssFullscreen(true);   // iPhone Safari has no full screen for elements
    } else {
      if (document.fullscreenElement) document.exitFullscreen();
      setCssFullscreen(false);
    }
  }
  function setCssFullscreen(on) {
    cssFullscreen = on;
    mapBox().classList.toggle('is-fullscreen', on);
    document.documentElement.classList.toggle('map-fullscreen', on);
    afterFullscreenChange();
  }
  function afterFullscreenChange() {
    if (!map) return;
    const full = isFullscreen();
    // in full screen there is no page to scroll: one finger moves the map, the wheel zooms without Ctrl
    if (map.cooperativeGestures) full ? map.cooperativeGestures.disable() : map.cooperativeGestures.enable();
    const btn = mapBox().querySelector('.map-btn-full');
    if (btn) {
      btn.classList.toggle('is-on', full);
      btn.setAttribute('aria-label', full ? T.fullscreenOff : T.fullscreenOn);
      btn.title = btn.getAttribute('aria-label');
    }
    if (!full) profileOpen = false;   // leaving full screen closes the profile
    placeProfile();
    map.resize();
    fitRoute();
  }
  document.addEventListener('fullscreenchange', afterFullscreenChange);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cssFullscreen) setCssFullscreen(false); });

  // Frame the route; in full screen keep it above the info box and the profile
  function fitRoute() {
    if (!map) return;
    const pad = window.innerWidth > 700 ? 60 : 30;
    const boxes = [$('fs-card'), $('fs-profile')].filter(b => b && !b.hidden);
    const bottom = isFullscreen() && boxes.length
      ? map.getContainer().clientHeight - Math.min(...boxes.map(b => b.offsetTop)) + 14 : pad;
    map.fitBounds(boundsOf(allPoints()), { padding: { top: pad, bottom, left: pad, right: pad + 40 }, duration: 700 });
  }

  /* ── Event box over the map, shown only in full screen (styles in tracks.css) ── */
  function makeFullscreenCard() {
    const card = document.createElement('section');
    card.className = 'fs-card'; card.id = 'fs-card';
    card.innerHTML = `
      <div class="fs-top"><h2 class="fs-name" id="fs-name"></h2></div>
      <div class="fs-meta" id="fs-meta"></div>
      <p class="fs-desc" id="fs-desc" title="${T.readAll}"></p>
      <div class="fs-actions" id="fs-actions"></div>`;
    ['mousedown', 'touchstart', 'wheel', 'dblclick'].forEach(ev => card.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    return card;
  }

  function fillFullscreenCard() {
    const event = currentEvent;
    if (!event || !$('fs-card')) return;
    $('fs-name').textContent = event.name;
    $('fs-meta').textContent = routeText(event);
    const desc = $('fs-desc');
    desc.textContent = event.description; desc.hidden = !event.description; desc.classList.remove('is-open');
    desc.onclick = () => { desc.classList.toggle('is-open'); placeProfile(); };
    const actions = $('fs-actions');
    actions.textContent = '';
    if (isWebLink(event.gpx)) {
      const a = document.createElement('a');
      a.className = 'btn btn-red'; a.href = event.gpx; a.textContent = '↓ GPX';
      a.dataset.countEvent = 'gpx-evento-' + event.id; a.dataset.countTitle = 'GPX evento: ' + event.name;
      actions.appendChild(a);
    }
    if (isWebLink(event.strava)) {
      const a = document.createElement('a');
      a.className = 'btn'; a.href = event.strava; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Strava';
      actions.appendChild(a);
    }
    if (event.profile.length > 1) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn fs-profile-btn'; b.title = T.profileHelp; b.textContent = T.profile;
      b.addEventListener('click', () => toggleProfile(!profileOpen));
      actions.appendChild(b);
    }
    placeProfile();
  }

  /* ── Elevation profile at the bottom of the full-screen map: opens and closes ──
     The very same profile of the page is moved in there. */
  let profileOpen = false;
  function makeFullscreenProfile() {
    const panel = document.createElement('div');
    panel.className = 'fs-profile'; panel.id = 'fs-profile'; panel.hidden = true;
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'fs-profile-close'; close.textContent = '✕';
    close.setAttribute('aria-label', T.closeProfile); close.title = T.closeProfile;
    close.addEventListener('click', () => toggleProfile(false));
    panel.appendChild(close);
    ['mousedown', 'touchstart', 'wheel', 'dblclick'].forEach(ev => panel.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    return panel;
  }
  function placeProfile() {
    const panel = $('fs-profile'), profile = $('profile');
    if (!panel || !profile) return;
    const inPanel = isFullscreen() && profileOpen && currentEvent.profile.length > 1;
    if (inPanel && profile.parentNode !== panel) panel.appendChild(profile);
    if (!inPanel && profile.parentNode === panel) $('event-route').appendChild(profile);
    panel.hidden = !inPanel;
    mapBox().classList.toggle('has-fs-profile', inPanel);
    const btn = document.querySelector('.fs-profile-btn');
    if (btn) btn.hidden = inPanel;   // profile already open: the button isn't needed
    // computer: the profile sits to the right of the box, as tall as the box with the description closed
    const card = $('fs-card');
    panel.style.height = inPanel && window.innerWidth > 700 && card ? Math.max(140, closedCardHeight(card)) + 'px' : '';
  }
  function closedCardHeight(card) {
    const desc = $('fs-desc');
    const open = desc.classList.contains('is-open');
    if (open) desc.classList.remove('is-open');
    const height = card.offsetHeight;
    if (open) desc.classList.add('is-open');
    return height;
  }
  function toggleProfile(open) {
    profileOpen = open;
    placeProfile();
    fitRoute();
  }

  const routeShape = () => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: currentEvent.line } });

  function showRouteOnMap() {
    map.getSource('route').setData(routeShape());
    addStartFinish();
    fitRoute();
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

  // the route plus the highlighted places, so that the map frames all of them
  const allPoints = () => currentEvent.line.concat(currentEvent.places.map(q => [q.lon, q.lat]));

  function addStartFinish() {
    endMarkers.forEach(m => m.remove());
    endMarkers = [];
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
    // Places from the Sheet (e.g. where we have lunch): tapping one opens it in Google Maps
    currentEvent.places.forEach(q => {
      const m = marker('pin-place', '', [q.lon, q.lat]);
      const el = m.getElement();
      el.querySelector('.pin-label').textContent = q.nome;   // text, never HTML
      el.title = q.nome;
      el.addEventListener('click', () => window.open('https://www.google.com/maps/search/?api=1&query=' + q.lat + ',' + q.lon, '_blank', 'noopener'));
      endMarkers.push(m);
    });
    endMarkers.push(...(loop ? [marker('pin-start', T.startFinish, a)] : [marker('pin-end', T.finish, b), marker('pin-start', T.start, a)]));
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
