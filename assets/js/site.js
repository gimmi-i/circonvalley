/* ==========================================================================
   Circonvalley Bikes — shared script (every page)
   - mobile menu
   - merch preorder status (read from the Google Sheet, see config.js)
   - "do not click" easter egg
   Needs config.js loaded first.
   ========================================================================== */

(function () {
  'use strict';

  /* ── Language ──
     Italian pages are at the root (/, /merch/, /tracce/), English ones under /en/
     (/en/, /en/merch/, /en/routes/). Every page says its language in <html lang>. */
  const LANG = document.documentElement.lang === 'en' ? 'en' : 'it';
  // Address of the site's root folder, taken from config.js (loaded by every page)
  const configScript = document.querySelector('script[src$="config.js"]');
  const ROOT = configScript ? new URL('.', configScript.src).href : new URL('/', location.href).href;

  // The "IT / EN" link keeps you in the same place: same section, same track
  const SAME_SECTION = { '#contatti': '#contacts', '#contacts': '#contatti' };
  document.querySelectorAll('[data-lang-switch]').forEach(a => a.addEventListener('click', () => {
    const hash = location.hash;
    if (hash) a.href = a.href.split('#')[0] + (SAME_SECTION[hash] || hash);
  }));

  /* ── Mobile menu ── */
  const navLinks = document.getElementById('nav-links');
  const navToggle = document.querySelector('.nav-toggle');
  const navBackdrop = document.querySelector('.nav-backdrop');

  function setMenuOpen(open) {
    navLinks.classList.toggle('open', open);
    navBackdrop.classList.toggle('open', open);
    navToggle.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open);
  }
  if (navLinks && navToggle && navBackdrop) {
    navToggle.addEventListener('click', () => setMenuOpen(!navLinks.classList.contains('open')));
    navBackdrop.addEventListener('click', () => setMenuOpen(false));
    navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenuOpen(false)));
  }

  /* ── Merch preorder status ──
     The Apps Script answers in Italian field names; this is the only place
     that knows them. Everything else uses the normalized object below. */
  const STATUS_CACHE_KEY = 'cvb:preorder';
  const OPTION_NAMES = { taglia: 'size', maniche: 'sleeves', 'tasche-gambe': 'legPockets', 'tasca-schiena': 'backPocket' };

  function normalizeStatus(raw) {
    const ship = raw.spedizioni;
    const pay = raw.pagamenti;
    return {
      isOpen: !!raw.open,
      opensOn: raw.apertura || '',
      closesOn: raw.chiusura || '',
      shippingCosts: ship ? { italy: ship.italia, eu: ship.ue } : null,
      payment: pay && pay.iban ? { paypalMe: pay.paypalMe, iban: pay.iban, accountHolder: pay.intestatario } : null,
      // both languages are kept (the saved copy is shared by the Italian and English pages):
      // pages pick theirs with Site.inLanguage()
      handDeliveryInfo: raw.infoConsegnaMano || '',
      handDeliveryInfoEn: raw.infoConsegnaManoEn || '',
      products: Array.isArray(raw.products) ? raw.products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        description: p.descrizione || '',
        descriptionEn: p.descrizioneEn || '',
        images: p.images || [],
        options: (p.options || []).map(o => OPTION_NAMES[o]).filter(Boolean),
      })) : null,
    };
  }

  /* Last answer from the Sheet, kept in the browser so pages can show it
     instantly while the (slow, 1–3 s) Apps Script answers. */
  function readCachedStatus() {
    try { return JSON.parse(localStorage.getItem(STATUS_CACHE_KEY)) || null; } catch (e) { return null; }
  }
  function cacheStatus(status) {
    try { localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ ...status, open: status.isOpen, savedAt: Date.now() })); } catch (e) { /* private mode */ }
  }

  let statusRequest = null;
  /** Fetches the preorder status once per page; resolves to the normalized status. */
  function getPreorderStatus() {
    if (!statusRequest) {
      statusRequest = fetch(PREORDER_API_URL)
        .then(r => r.json())
        .then(raw => {
          const status = normalizeStatus(raw);
          cacheStatus(status);
          return status;
        });
    }
    return statusRequest;
  }

  /* Merch links and homepage banner: shown at once from the last known status,
     then corrected by the fresh answer from the Sheet. */
  function showPreorder(open, closesOn) {
    document.documentElement.classList.toggle('preorder-open', open);
    const text = document.getElementById('merch-banner-text');
    if (text) text.textContent = !closesOn ? ''
      : LANG === 'en' ? `Preorder open until ${closesOn}.` : `Preorder aperto fino al ${closesOn}.`;
    fitBannerTitle();
  }

  // Phone: the "Preorder Merch" title grows/shrinks to the width of the button below it
  function fitBannerTitle() {
    const title = document.getElementById('merch-banner-title');
    const button = document.getElementById('merch-banner-button');
    if (!title || !button) return;
    title.parentElement.style.fontSize = '';
    if (window.innerWidth > 700 || !button.offsetWidth) return;
    const base = parseFloat(getComputedStyle(title.parentElement).fontSize);
    title.parentElement.style.fontSize = (base * button.offsetWidth / title.offsetWidth) + 'px';
  }
  window.addEventListener('resize', fitBannerTitle);

  if (document.querySelector('.preorder-only')) {
    const cached = readCachedStatus();
    if (cached) showPreorder(!!cached.open, cached.closesOn);
    getPreorderStatus().then(s => showPreorder(s.isOpen, s.closesOn)).catch(() => {});
  }

  /* ── "do not click": the GIF covers the whole screen; click anywhere or Esc to close ── */
  const egg = document.createElement('div');
  egg.className = 'dnc-overlay';
  egg.setAttribute('role', 'dialog');
  egg.setAttribute('aria-label', 'do not click');
  const eggStyle = document.createElement('style');
  eggStyle.textContent =
    '.dnc-overlay{position:fixed;inset:0;z-index:9999;background:#000;cursor:pointer;display:none}' +
    '.dnc-overlay.open{display:block}' +
    '.dnc-overlay img{width:100%;height:100%;object-fit:cover;display:block}' +
    'body.dnc-lock{overflow:hidden}';
  document.head.appendChild(eggStyle);
  document.body.appendChild(egg);

  function openEgg(e) {
    e.preventDefault();
    // the GIF loads only on click and always restarts from the beginning
    egg.innerHTML = '';
    const img = new Image();
    img.src = e.currentTarget.href;
    img.alt = '';
    egg.appendChild(img);
    egg.classList.add('open');
    document.body.classList.add('dnc-lock');
  }
  function closeEgg() {
    egg.classList.remove('open');
    egg.innerHTML = '';
    document.body.classList.remove('dnc-lock');
  }
  egg.addEventListener('click', closeEgg);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && egg.classList.contains('open')) closeEgg(); });
  document.querySelectorAll('[data-do-not-click]').forEach(a => a.addEventListener('click', openEgg));

  /* ── Second easter egg: click "Contatti", then the logo 4 times in a row → an mp3 plays ──
     Clicking "Contatti" arms it (remembered in sessionStorage, so it also works when
     "Contatti" takes you from another page to the homepage). Any other click disarms it.
     While armed, a logo click waits a moment for the next one: if the 4 clicks don't
     arrive, the logo does its normal job (back to the homepage). */
  const SONG_URL = ROOT + 'assets/audio/easter-egg.mp3';
  const ARMED_KEY = 'cvb:egg-armed';
  const CLICK_GAP_MS = 800;
  const isArmed = () => { try { return sessionStorage.getItem(ARMED_KEY) === '1'; } catch (e) { return false; } };
  const setArmed = on => { try { on ? sessionStorage.setItem(ARMED_KEY, '1') : sessionStorage.removeItem(ARMED_KEY); } catch (e) {} };

  let song = null;
  let logoClicks = 0;
  let logoTimer = null;

  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (link && /#(contatti|contacts)$/.test(link.getAttribute('href') || '')) { setArmed(true); return; }
    if (link && link.closest('.site-logo')) return; // handled below
    setArmed(false);
    logoClicks = 0;
  }, true);

  document.querySelectorAll('.site-logo a').forEach(logo => {
    logo.style.touchAction = 'manipulation'; // no double-tap zoom on phones
    logo.addEventListener('click', e => {
      if (!isArmed()) return;
      e.preventDefault();
      if (!song) { song = new Audio(SONG_URL); song.preload = 'auto'; }
      logoClicks++;
      clearTimeout(logoTimer);
      if (logoClicks >= 4) {
        song.currentTime = 0;
        song.play().catch(() => {});
        logoClicks = 0;
        setArmed(false);
        return;
      }
      logoTimer = setTimeout(() => {
        // not 4 clicks in a row: behave like a normal logo click
        logoClicks = 0;
        setArmed(false);
        location.href = logo.href;
      }, CLICK_GAP_MS);
    });
  });

  /** Text in the page's language: the English one if there is, otherwise the Italian one */
  const inLanguage = (italian, english) => (LANG === 'en' && english) ? english : italian;

  window.Site = { lang: LANG, root: ROOT, inLanguage, getPreorderStatus, getCachedStatus: readCachedStatus };
})();
