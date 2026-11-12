/* ==========================================================================
   Homepage: small preview of the next event, with a button to the Eventi page.
   Same data and same saved copy as events.js (Eventi Sheet, URL in config.js).
   With no upcoming event the section stays hidden.
   Needs config.js and site.js loaded first.
   ========================================================================== */

(function () {
  'use strict';

  const CACHE_KEY = 'cvb:next-event';   // shared with events.js
  const locale = Site.lang === 'en' ? 'en-GB' : 'it-IT';
  const meetAt = Site.lang === 'en' ? 'meet at ' : 'ritrovo ore ';
  const $ = id => document.getElementById(id);
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

  // The Apps Script answers in Italian field names
  function upcomingEvent(text) {
    const data = JSON.parse(text);
    if (!data || !('evento' in data)) throw new Error('Unexpected answer from the Sheet');
    return data.evento && data.evento.nome && data.evento.data >= today() ? data.evento : null;
  }

  function render(ev) {
    const section = document.querySelector('.next-event');
    section.hidden = !ev;
    if (!ev) return;

    const [y, m, d] = ev.data.split('-').map(Number);
    $('next-event-name').textContent = ev.nome;
    const when = $('next-event-when');
    when.textContent = '';
    const date = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    const place = [ev.luogo, ev.oraRitrovo ? meetAt + ev.oraRitrovo : ''].filter(Boolean).join(', ');
    [date, place].filter(Boolean).forEach((line, i) => {
      if (i) when.appendChild(document.createElement('br'));
      when.appendChild(document.createTextNode(line));
    });

    const link = $('next-event-poster'), img = $('next-event-img');
    const showPoster = on => { link.hidden = !on; section.querySelector('.next-event-inner').classList.toggle('no-poster', !on); };
    if (!ev.locandina) return showPoster(false);
    let usedFallback = false;
    img.onerror = () => {
      if (usedFallback || !ev.locandinaRiserva) return showPoster(false);
      usedFallback = true;
      img.src = ev.locandinaRiserva;
    };
    if (img.getAttribute('src') !== ev.locandina) img.src = ev.locandina;
    showPoster(true);
  }

  async function start() {
    let cached = null;
    try { cached = localStorage.getItem(CACHE_KEY); } catch (e) { /* no storage */ }
    if (cached) {
      try { render(upcomingEvent(cached)); } catch (e) { /* damaged copy: ignore it */ }
    }
    if (typeof EVENTS_API_URL === 'undefined' || !EVENTS_API_URL) return;
    try {
      const fresh = await (await fetch(EVENTS_API_URL)).text();
      const ev = upcomingEvent(fresh);   // throws if the answer is not valid
      try { localStorage.setItem(CACHE_KEY, fresh); } catch (e) { /* fine */ }
      if (fresh !== cached) render(ev);
    } catch (err) {
      console.error(err);   // the preview simply stays as it is (or hidden)
    }
  }

  start();
})();
