/* ==========================================================================
   Tracks page (tracce/)
   Tracks come from the "Sito CVB - Gestione Tracce" Google Sheet (Tracce.gs,
   URL in config.js). The map uses MapLibre + OpenFreeMap tiles.
   Needs config.js and site.js loaded first.
   ========================================================================== */

(function () {
  'use strict';

  const MAPLIBRE_URL = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
  // Fixed first view: Milan in the middle, up to about 10 km north of Lecco.
  // The east-west strip is narrow on purpose: it sets the height, the width follows the screen.
  const INITIAL_BOUNDS = [[9.18, 44.982], [9.20, 45.946]];
  const ARROW_ICON = 'cvb-direction-arrow';
  const LOOP_DISTANCE_M = 300;  // start and finish closer than this = loop ride, one marker only
  const PROFILE_SMOOTHING = 1.5;  // higher = smoother elevation profile. NOTE: decimals with a DOT (1.5), not a comma

  // Bike types: colour on the map and dot in the list.
  // In the Sheet it's picked in the "Tipo di bici" column.
  const BIKE_TYPES = {
    fixed:  { label: 'Fixed friendly',  color: '#2f9e44' },
    road:   { label: 'Strada',          color: '#1c64d4' },
    gravel: { label: 'Gravel leggero',  color: '#e6b000' },
    rough:  { label: 'Gravel scassato', color: '#ee7a00' },
    mtb:    { label: 'MTB',             color: '#e10600' },
    other:  { label: 'Altro',           color: '#7a7a7a' },
  };
  const BIKE_TYPE_ORDER = Object.keys(BIKE_TYPES);
  function bikeTypeOf(text) {
    const s = String(text || '').toLowerCase();
    if (/fix/.test(s)) return 'fixed';
    if (/mtb|mountain/.test(s)) return 'mtb';
    if (/scassat/.test(s)) return 'rough';
    if (/gravel/.test(s)) return 'gravel';
    if (/strad|road|corsa/.test(s)) return 'road';
    return 'other';
  }

  /* ── State ── */
  let tracks = [];
  let shownTypes = new Set(BIKE_TYPE_ORDER);
  let sortOrder = null;    // { key, direction: 1 | -1 }; null = order of the Sheet rows
  let map = null;
  let selected = null;
  let hoverMarker = null;  // dot following the pointer on the elevation profile
  let endMarkers = [];     // start / finish

  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const formatNumber = (n, decimals) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: decimals || 0 });
  const metaText = t => [t.km ? formatNumber(t.km, 1) + ' km' : '', t.climb ? formatNumber(t.climb) + ' m d+' : '']
    .filter(Boolean).map(escapeHtml).join(' · ');

  /* ── Loading: data and map library in parallel ── */
  function loadMapLibrary() {
    return new Promise(resolve => {
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
  const mapLibraryReady = loadMapLibrary();

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

  // Profile from the Sheet: "km,elevation,lat,lon;…"
  function parseProfile(text) {
    if (!text) return [];
    const points = String(text).split(';').map(s => {
      const [km, ele, lat, lon] = s.split(',').map(Number);
      return { km, ele, lat, lon };
    }).filter(p => !isNaN(p.ele));
    try { return smoothProfile(points); } catch (err) { console.error(err); return points; }   // never block the page
  }

  // Bell-shaped weighted average over nearby points:
  // removes GPS jitter without changing the shape of the climbs.
  function smoothProfile(points) {
    const r = Math.ceil(PROFILE_SMOOTHING * 3);
    const weights = [];
    for (let k = -r; k <= r; k++) weights.push(Math.exp(-(k * k) / (2 * PROFILE_SMOOTHING * PROFILE_SMOOTHING)));
    return points.map((q, i) => {
      let sum = 0, total = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k;
        if (j < 0 || j >= points.length) continue;
        sum += points[j].ele * weights[k + r];
        total += weights[k + r];
      }
      return { ...q, ele: sum / total };
    });
  }

  /* The Apps Script (Tracce.gs) answers in Italian field names; this is the only place that knows them */
  function normalizeTrack(raw, index) {
    const bikeType = bikeTypeOf(raw.terreno);
    return {
      id: raw.id,
      name: raw.nome,
      description: raw.descrizione || '',
      km: raw.km,
      climb: raw.dislivello,
      strava: raw.strava || '',
      author: raw.autore || '',
      gpx: raw.gpx,
      position: index,
      bikeType,
      color: BIKE_TYPES[bikeType].color,
      line: decodePolyline(raw.percorso || ''),
      profile: parseProfile(raw.profilo),
    };
  }

  /* The last answer from the Sheet is kept in the visitor's browser:
     on the next visit the tracks appear at once, and the page quietly
     asks the Sheet for news and updates itself if something changed. */
  const CACHE_KEY = 'cvb:tracks';
  function readCache() {
    try { return localStorage.getItem(CACHE_KEY); } catch (e) { return null; }
  }
  function writeCache(text) {
    try { localStorage.setItem(CACHE_KEY, text); } catch (e) { /* storage full or blocked: no cache */ }
  }
  function parseTracks(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.tracce)) throw new Error('Unexpected answer from the Sheet');
    return data.tracce.map(normalizeTrack).filter(t => t.line.length > 1);
  }
  async function fetchTracksText() {
    if (typeof TRACKS_API_URL === 'undefined' || !TRACKS_API_URL) throw new Error('TRACKS_API_URL missing in config.js');
    const text = await (await fetch(TRACKS_API_URL)).text();
    parseTracks(text);   // throws if the answer is not valid
    return text;
  }

  async function start() {
    const cached = readCache();
    let shown = false;
    if (cached) {
      try { tracks = parseTracks(cached); shown = tracks.length > 0; } catch (e) { tracks = []; }
    }
    if (shown) {
      showTracks();
      fetchTracksText().then(fresh => {
        if (fresh === cached) return;
        writeCache(fresh);
        updateTracks(parseTracks(fresh));
      }).catch(err => console.error(err));   // offline or Sheet slow: the saved tracks stay
      return;
    }

    try {
      const fresh = await fetchTracksText();
      writeCache(fresh);
      tracks = parseTracks(fresh);
    } catch (err) {
      console.error(err);
      $('map-message').textContent = 'Non riusciamo a caricare le tracce in questo momento. Riprova tra poco.';
      return;
    }
    if (!tracks.length) { $('map-message').textContent = 'Nessuna traccia, per ora.'; return; }
    showTracks();
  }

  async function showTracks() {
    setUpTools();
    renderList();
    if (await mapLibraryReady) {
      startMap();
    } else {
      $('map-message').textContent = 'La mappa non si è caricata, ma qui sotto trovi tutte le tracce.';
      readHash();
    }
  }

  /* ── Filters and sorting ── */
  function setUpTools() {
    renderChips();
    $('sorts').querySelectorAll('.sort').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      sortOrder = (sortOrder && sortOrder.key === key) ? { key, direction: -sortOrder.direction } : { key, direction: 1 };
      $('sorts').querySelectorAll('.sort').forEach(x => {
        const on = x.dataset.sort === key;
        x.setAttribute('aria-pressed', on);
        x.querySelector('.arrow').textContent = on ? (sortOrder.direction === 1 ? '↑' : '↓') : '';
      });
      renderList();
    }));
    $('tools').hidden = false;
  }

  function renderChips() {
    const present = BIKE_TYPE_ORDER.filter(k => tracks.some(t => t.bikeType === k));
    $('chips').hidden = present.length < 2;
    if (present.length > 1) {
      $('chips').innerHTML = present.map(k => `
        <button class="chip" type="button" data-type="${k}" aria-pressed="${shownTypes.has(k)}" style="--c:${BIKE_TYPES[k].color}">
          <span class="swatch">✓</span>${BIKE_TYPES[k].label}
        </button>`).join('');
      $('chips').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.type;
        shownTypes.has(k) ? shownTypes.delete(k) : shownTypes.add(k);
        b.setAttribute('aria-pressed', shownTypes.has(k));
        if (selected && !shownTypes.has(selected.bikeType)) select(null);
        renderList();
        filterMap();
      }));
    }
  }

  // Fresh data arrived after the saved tracks were already on screen
  function updateTracks(fresh) {
    if (!fresh.length) return;   // never empty the page because of a hiccup
    tracks = fresh;
    renderChips();
    renderList();
    if (map && map.getSource('tracks')) {
      map.getSource('tracks').setData(trackFeatures());
      filterMap();
    }
    if (selected) {
      const still = tracks.find(t => t.id === selected.id);
      if (still) show(still.id, false, true); else select(null);
    }
  }

  function trackFeatures() {
    return {
      type: 'FeatureCollection',
      features: tracks.map(t => ({
        type: 'Feature',
        properties: { id: t.id, bikeType: t.bikeType, color: t.color },
        geometry: { type: 'LineString', coordinates: t.line },
      })),
    };
  }

  const COMPARE = {
    name: (a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }),
    km: (a, b) => a.km - b.km,
    climb: (a, b) => a.climb - b.climb,
    bike: (a, b) => BIKE_TYPE_ORDER.indexOf(a.bikeType) - BIKE_TYPE_ORDER.indexOf(b.bikeType) || a.km - b.km,
  };
  function visibleTracks() {
    const list = tracks.filter(t => shownTypes.has(t.bikeType));
    if (!sortOrder) return list;
    const compare = COMPARE[sortOrder.key];
    return list.slice().sort((a, b) => sortOrder.direction * compare(a, b) || a.position - b.position);
  }

  function renderList() {
    const list = visibleTracks();
    $('list-label').textContent = list.length === 1 ? '1 traccia' : list.length + ' tracce';
    if (!list.length) { $('track-grid').innerHTML = '<p class="empty">Nessuna traccia con questi filtri.</p>'; return; }
    $('track-grid').innerHTML = list.map(t => `
      <article class="track-card${selected && selected.id === t.id ? ' is-selected' : ''}" data-id="${escapeHtml(t.id)}">
        <div class="card-top">
          <div class="card-name">${escapeHtml(t.name)}</div>
          <span class="dot" style="background:${t.color}" title="${BIKE_TYPES[t.bikeType].label}" aria-label="${BIKE_TYPES[t.bikeType].label}"></span>
        </div>
        <div class="meta">${metaText(t)}</div>
        ${t.author ? `<div class="author">Autore: ${escapeHtml(t.author)}</div>` : ''}
        ${t.description ? `<div class="card-desc">${escapeHtml(t.description)}</div>` : ''}
        <div class="card-actions">
          <button class="link dark" type="button">Vedi sulla mappa</button>
          <a class="link" href="${escapeHtml(t.gpx)}">↓ GPX</a>
        </div>
      </article>`).join('');
  }
  $('track-grid').addEventListener('click', e => {
    const card = e.target.closest('.track-card');
    if (card && !e.target.closest('a')) select(card.dataset.id, true);   // the GPX link just downloads
  });

  /* ── Map ── */
  function startMap() {
    $('map-message').hidden = true;
    $('map').hidden = false;

    const touchScreen = window.matchMedia('(pointer: coarse)').matches;
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE,
      bounds: INITIAL_BOUNDS,
      attributionControl: { compact: true },
      cooperativeGestures: touchScreen,   // phone: two fingers move the map, one finger scrolls the page
      dragRotate: false,
      pitchWithRotate: false,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + rotellina per ingrandire la mappa',
        'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + rotellina per ingrandire la mappa',
        'CooperativeGesturesHandler.MobileHelpText': 'Usa due dita per spostare la mappa',
        'NavigationControl.ZoomIn': 'Ingrandisci',
        'NavigationControl.ZoomOut': 'Rimpicciolisci',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      recolorMap();
      map.addSource('tracks', { type: 'geojson', data: trackFeatures() });
      const round = { 'line-join': 'round', 'line-cap': 'round' };
      const none = ['==', ['get', 'id'], ''];
      map.addLayer({ id: 'tracks-casing', type: 'line', source: 'tracks', layout: round,
        paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'tracks', type: 'line', source: 'tracks', layout: round,
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'selected-casing', type: 'line', source: 'tracks', layout: round, filter: none,
        paint: { 'line-color': '#ffffff', 'line-width': 11 } });
      map.addLayer({ id: 'selected', type: 'line', source: 'tracks', layout: round, filter: none,
        paint: { 'line-color': ['get', 'color'], 'line-width': 7 } });
      // thin white arrows along the selected track, in the riding direction
      // the name must be our own: the map style already has an icon called "arrow" (dark, for one-way roads)
      if (map.hasImage(ARROW_ICON)) map.removeImage(ARROW_ICON);
      map.addImage(ARROW_ICON, drawArrow(), { pixelRatio: 2 });
      map.addLayer({ id: 'selected-arrows', type: 'symbol', source: 'tracks', filter: none,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 80,
          'icon-image': ARROW_ICON, 'icon-size': 1,
          'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 1 } });
      // invisible wider band, so the lines are easy to tap
      map.addLayer({ id: 'tracks-hit-area', type: 'line', source: 'tracks', layout: round,
        paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } });

      map.on('click', 'tracks-hit-area', e => select(e.features[0].properties.id, false));
      map.on('mouseenter', 'tracks-hit-area', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'tracks-hit-area', () => { map.getCanvas().style.cursor = ''; });

      const dot = document.createElement('div');
      dot.className = 'hover-dot';
      hoverMarker = new maplibregl.Marker({ element: dot });

      filterMap();
      readHash();
    });
  }

  // Small white arrowhead (›), 6×6 px (fits inside the line), pointing along the line
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

  // Only the bike types picked in the filters stay on the map
  function filterMap() {
    if (!map || !map.getLayer('tracks')) return;
    const filter = ['in', ['get', 'bikeType'], ['literal', [...shownTypes]]];
    ['tracks-casing', 'tracks', 'tracks-hit-area'].forEach(layer => map.setFilter(layer, filter));
  }

  // Map colours in tune with the site: warm background, soft water and parks
  function recolorMap() {
    map.getStyle().layers.forEach(l => {
      try {
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f8f7f4');
        else if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#dfe4e6');
        else if (l.type === 'fill' && /park|wood|grass|landcover/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#ebeee4');
      } catch (e) { /* unexpected style: leave it as it is */ }
    });
  }

  function boundsOf(list) {
    const b = new maplibregl.LngLatBounds();
    list.forEach(t => t.line.forEach(p => b.extend(p)));
    return b;
  }

  /* ── Page scrolling between the list and the map ──
     The trip always takes about the same short time, so the farther the
     card is from the map, the faster the page moves. */
  const SCROLL_MIN_MS = 220;     // very short trips
  const SCROLL_MAX_MS = 480;     // very long trips (the speed grows with the distance)
  let scrollAnimation = 0;
  function scrollPageTo(target) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    target = Math.max(0, Math.min(max, Math.round(target)));
    const start = window.scrollY, distance = target - start;
    cancelAnimationFrame(scrollAnimation);
    if (Math.abs(distance) < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo({ top: target, behavior: 'instant' });
      return;
    }
    const duration = Math.min(SCROLL_MAX_MS, SCROLL_MIN_MS + Math.abs(distance) * 0.06);
    const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    const t0 = performance.now();
    const step = now => {
      const x = Math.min(1, (now - t0) / duration);
      window.scrollTo({ top: start + distance * ease(x), behavior: 'instant' });
      if (x < 1) scrollAnimation = requestAnimationFrame(step);
    };
    scrollAnimation = requestAnimationFrame(step);
  }
  // the visitor scrolls by hand: stop the animation
  ['wheel', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, () => cancelAnimationFrame(scrollAnimation), { passive: true }));

  /* ── Selecting a track ──
     The address changes (tracce/#track-name), so the link can be shared. */
  // Track opened from its card: closing it brings you back to that card
  let openedFromCard = null;

  function select(id, scroll) {
    openedFromCard = (id && scroll) ? id : null;
    const url = id ? '#' + id : location.pathname + location.search;
    if ((location.hash || '') !== (id ? '#' + id : '')) history.pushState(null, '', url);
    show(id, scroll);
  }
  $('detail-close').addEventListener('click', () => {
    const backTo = selected && openedFromCard === selected.id ? selected.id : null;
    select(null);
    if (backTo) {
      const card = document.querySelector(`.track-card[data-id="${CSS.escape(backTo)}"]`);
      if (card) {
        const r = card.getBoundingClientRect();
        scrollPageTo(window.scrollY + r.top - (window.innerHeight - r.height) / 2);
      }
    }
  });

  function readHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    show(tracks.some(t => t.id === id) ? id : null, false);
  }
  window.addEventListener('popstate', () => { if (tracks.length) readHash(); });

  function show(id, scroll, keepView) {
    const t = tracks.find(x => x.id === id) || null;
    selected = t;
    document.querySelectorAll('.track-card').forEach(c => c.classList.toggle('is-selected', !!t && c.dataset.id === t.id));
    if (hoverMarker) hoverMarker.remove();
    endMarkers.forEach(m => m.remove());
    endMarkers = [];

    if (map && map.getLayer('selected')) {
      if (t) addStartFinish(t);
      const filter = ['==', ['get', 'id'], t ? t.id : ''];
      ['selected', 'selected-casing', 'selected-arrows'].forEach(layer => map.setFilter(layer, filter));
      map.setPaintProperty('tracks', 'line-opacity', t ? 0.25 : 0.9);
      map.setPaintProperty('tracks-casing', 'line-opacity', t ? 0.3 : 0.9);
      if (keepView) { /* data refresh: don't move the map */ }
      else if (t) map.fitBounds(boundsOf([t]), { padding: window.innerWidth > 700 ? 60 : 30, duration: 700 });
      else map.fitBounds(INITIAL_BOUNDS, { duration: 700 });
    }

    if (!t) { $('detail').hidden = true; return; }

    $('detail-name').innerHTML = `<span class="dot" style="background:${t.color}"></span>${escapeHtml(t.name)}`;
    $('detail-author').textContent = t.author ? 'Autore: ' + t.author : '';
    $('detail-author').hidden = !t.author;
    $('detail-meta').innerHTML = [t.bikeType !== 'other' ? BIKE_TYPES[t.bikeType].label : '', metaText(t)].filter(Boolean).join(' · ');
    if (hoverMarker) hoverMarker.getElement().style.background = t.color;
    $('detail-desc').textContent = t.description;
    $('detail-desc').hidden = !t.description;
    $('detail-actions').innerHTML =
      `<a class="btn btn-red" href="${escapeHtml(t.gpx)}">↓ Scarica il GPX</a>` +
      (/^https:\/\//.test(t.strava) ? `<a class="btn" href="${escapeHtml(t.strava)}" target="_blank" rel="noopener">Apri su Strava</a>` : '');
    drawProfile(t);
    $('detail').hidden = false;
    if (scroll) {
      const el = $('map-section');
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      scrollPageTo(window.scrollY + el.getBoundingClientRect().top - margin);
    }
  }

  // Start and finish: on a loop ride they coincide, so there is a single marker
  function addStartFinish(t) {
    const a = t.line[0], b = t.line[t.line.length - 1];
    const loop = new maplibregl.LngLat(a[0], a[1]).distanceTo(new maplibregl.LngLat(b[0], b[1])) < LOOP_DISTANCE_M;
    const centre = boundsOf([t]).getCenter().lng;
    const marker = (cls, text, point) => {
      // the dot sits exactly on the point; the label points towards the middle of the track, so it stays on the map
      const left = point[0] > centre;
      const el = document.createElement('div');
      el.className = 'pin ' + cls + (left ? ' pin--left' : '');
      el.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${text}</span>`;
      return new maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? 8 : -8, 0] })
        .setLngLat(point).addTo(map);
    };
    if (loop) endMarkers.push(marker('pin-start', 'Partenza e arrivo', a));
    else endMarkers.push(marker('pin-end', 'Arrivo', b), marker('pin-start', 'Partenza', a));
  }

  /* ── Elevation profile ── */
  const PROFILE_W = 1000, PROFILE_H = 150, PROFILE_TOP = 22;
  function drawProfile(t) {
    const p = t.profile;
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
      <path d="${line} L ${PROFILE_W} ${PROFILE_H} L 0 ${PROFILE_H} Z" fill="${t.color}" fill-opacity="0.14"/>
      <path d="${line}" fill="none" stroke="${t.color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      <line id="profile-cursor" x1="0" x2="0" y1="0" y2="${PROFILE_H}" stroke="#111" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
  }

  // Hovering the profile shows km and elevation, and a dot on the matching point of the map
  function onProfile(ev) {
    if (!selected || selected.profile.length < 2) return;
    const r = $('profile-svg').getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const p = selected.profile;
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
    if (hoverMarker && !isNaN(q.lat)) hoverMarker.setLngLat([q.lon, q.lat]).addTo(map);
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
