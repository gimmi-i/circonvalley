/* Easter egg "do not click": al clic la GIF copre tutto lo schermo.
   Si chiude cliccando ovunque o col tasto Esc. */
(function () {
  var gif = new URL('images/do-not-click.gif', document.currentScript.src).href;

  var css = document.createElement('style');
  css.textContent =
    '.dnc-overlay{position:fixed;inset:0;z-index:9999;background:#000;cursor:pointer;display:none}' +
    '.dnc-overlay.open{display:block}' +
    '.dnc-overlay img{width:100%;height:100%;object-fit:cover;display:block}' +
    'body.dnc-lock{overflow:hidden}';
  document.head.appendChild(css);

  var overlay = document.createElement('div');
  overlay.className = 'dnc-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'do not click');
  document.body.appendChild(overlay);

  function apri(e) {
    e.preventDefault();
    // La GIF si carica solo al clic e riparte sempre dall'inizio
    overlay.innerHTML = '<img src="' + gif + '" alt="">';
    overlay.classList.add('open');
    document.body.classList.add('dnc-lock');
  }
  function chiudi() {
    overlay.classList.remove('open');
    overlay.innerHTML = '';
    document.body.classList.remove('dnc-lock');
  }

  overlay.addEventListener('click', chiudi);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) chiudi();
  });
  document.querySelectorAll('[data-do-not-click]').forEach(function (a) {
    a.addEventListener('click', apri);
  });
})();
