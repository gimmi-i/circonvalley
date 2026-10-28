/* ==========================================================================
   Merch preorder shop (merch/)
   Products, prices, shipping costs and payment details come from the merch
   Google Sheet (see config.js): nothing to edit here to change the catalog.
   Needs config.js and site.js loaded first.
   ========================================================================== */

(function () {
  'use strict';

  const SIZES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  const imageUrl = file => Site.root + 'images/' + file;
  const EMAIL = 'thecirconvalley@gmail.com';

  /* Texts written by this script. The fixed texts are in merch/index.html and en/merch/index.html. */
  const TEXTS = {
    it: {
      shipping: { italy: 'Spedizione Italia', eu: 'Spedizione UE', extra: 'Spedizione extra UE', hand: 'Consegna a mano' },
      error: 'Si è verificato un errore. Riprova o contattaci direttamente.',
      size: 'Taglia', sleeves: 'Tipo di manica', legPockets: 'Tasche sulle gambe', backPocket: 'Tasca sulla schiena',
      shortSleeve: 'Manica corta', longSleeve: 'Manica lunga', yes: 'Sì', no: 'No',
      detailSize: 'Taglia', detailSleeve: 'Manica', short: 'Corta', long: 'Lunga',
      detailLegPockets: 'Tasche gambe', detailBackPocket: 'Tasca schiena',
      pickAllOptions: 'Seleziona tutte le opzioni obbligatorie.',
      cartEmpty: 'Il carrello è vuoto.', goToCatalog: 'Vai alla collezione', remove: 'Rimuovi', total: 'Totale',
      toCheckout: 'Procedi al checkout →', toAgree: 'da concordare', shippingExcluded: ' (spedizione esclusa)',
      sending: 'Elaborazione...', confirm: 'Conferma ordine →',
      totalExtraEu: ' + spedizione da concordare',
      emailSent: email => `Ti abbiamo mandato un'email di riepilogo a ${email} (se non la trovi, guarda nello spam).`,
      extraEuWarning: (link, code) => `<strong>Prima di pagare, scrivici</strong> a ${link} con il codice <strong>${code}</strong>: ti diremo il totale con la spedizione.`,
      extraEuSubject: 'Spedizione extra UE',
      payPaypal: 'Paga con PayPal', goToPaypal: 'Vai a PayPal', payOnPaypal: total => `Paga €${total} su PayPal`,
      paypalNote: code => `Nel messaggio del pagamento scrivi il codice <strong>${code}</strong>.`,
      payBank: 'Paga con bonifico', holder: 'Intestatario', amount: 'Importo', reference: 'Causale',
      opensOn: date => `Il preorder è chiuso. Prossima apertura: ${date}.`,
      loadError: 'Impossibile caricare il negozio. Riprova tra poco.',
    },
    en: {
      shipping: { italy: 'Shipping to Italy', eu: 'Shipping to the EU', extra: 'Shipping outside the EU', hand: 'Hand delivery' },
      error: 'Something went wrong. Try again or get in touch with us.',
      size: 'Size', sleeves: 'Sleeves', legPockets: 'Leg pockets', backPocket: 'Back pocket',
      shortSleeve: 'Short sleeves', longSleeve: 'Long sleeves', yes: 'Yes', no: 'No',
      detailSize: 'Size', detailSleeve: 'Sleeves', short: 'Short', long: 'Long',
      detailLegPockets: 'Leg pockets', detailBackPocket: 'Back pocket',
      pickAllOptions: 'Please choose all the required options.',
      cartEmpty: 'Your cart is empty.', goToCatalog: 'Go to the collection', remove: 'Remove', total: 'Total',
      toCheckout: 'Go to checkout →', toAgree: 'to be agreed', shippingExcluded: ' (shipping not included)',
      sending: 'Sending...', confirm: 'Place order →',
      totalExtraEu: ' + shipping to be agreed',
      emailSent: email => `We sent a summary email to ${email} (if you can’t find it, check your spam folder).`,
      extraEuWarning: (link, code) => `<strong>Before paying, write to us</strong> at ${link} with the code <strong>${code}</strong>: we’ll tell you the total including shipping.`,
      extraEuSubject: 'Shipping outside the EU',
      payPaypal: 'Pay with PayPal', goToPaypal: 'Go to PayPal', payOnPaypal: total => `Pay €${total} on PayPal`,
      paypalNote: code => `Write the code <strong>${code}</strong> in the payment message.`,
      payBank: 'Pay by bank transfer', holder: 'Account holder', amount: 'Amount', reference: 'Payment reference',
      opensOn: date => `The preorder is closed. Next opening: ${date}.`,
      loadError: 'The shop can’t be loaded right now. Try again in a moment.',
    },
  };
  const T = TEXTS[Site.lang];
  const SHIPPING_LABELS = T.shipping;
  const ERROR_TEXT = T.error;

  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── State ── */
  let products = [];
  let shippingCosts = { italy: 6, eu: 11 };
  let payment = (typeof PAYMENT_FALLBACK !== 'undefined') ? PAYMENT_FALLBACK : {};
  let cart = [];
  let nextCartId = 0;
  let current = null;      // product open in the product window
  let choices = {};        // options picked in the product window
  let galleryIndex = 0;
  let shipping = 'italy';  // italy | eu | extra | hand
  let paymentMethod = 'paypal';  // paypal | bank

  /* ── Views ── */
  const VIEWS = ['loading', 'closed', 'catalog', 'cart', 'checkout', 'success'];
  let currentView = 'loading';
  function showView(name) {
    currentView = name;
    VIEWS.forEach(v => $('view-' + v).classList.toggle('hidden', v !== name));
    if (name === 'cart') renderCart();
    if (name === 'checkout') renderSummary();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  /* Opening a window locks the page scroll behind it */
  function setOverlay(id, open) {
    $(id).classList.toggle('hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  /* ── Catalog ── */
  function renderProducts() {
    $('products-grid').innerHTML = products.map(p => `
      <div class="product-card" data-product="${escapeHtml(p.id)}">
        <img src="${escapeHtml(imageUrl(p.images[0]))}" class="product-img" alt="${escapeHtml(p.name)}" decoding="async">
        <div class="product-row">
          <div class="product-name">${escapeHtml(p.name)}</div>
          <div class="product-price">€${p.price}</div>
        </div>
      </div>`).join('');
  }
  $('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (card) openProduct(card.dataset.product);
  });

  /* ── Product window ── */
  function openProduct(id) {
    current = products.find(p => p.id === id);
    choices = {};
    galleryIndex = 0;
    renderGallery();
    const description = Site.inLanguage(current.description, current.descriptionEn);
    $('product-description').textContent = description;
    $('product-description').style.display = description ? '' : 'none';
    $('product-name').textContent = current.name;
    $('product-price').textContent = '€' + current.price;
    renderOptions();
    setOverlay('product-overlay', true);
  }
  function closeProduct() {
    setOverlay('product-overlay', false);
    current = null;
    choices = {};
  }
  $('product-close').addEventListener('click', closeProduct);
  $('product-overlay').addEventListener('click', e => { if (e.target.id === 'product-overlay') closeProduct(); });

  function renderGallery() {
    const images = current.images;
    $('gallery-main').src = imageUrl(images[galleryIndex]);
    $('gallery-main').alt = current.name;
    document.querySelectorAll('.gallery-arrow').forEach(b => { b.style.display = images.length > 1 ? '' : 'none'; });
    $('gallery-thumbs').innerHTML = images.length > 1
      ? images.map((f, i) => `<img src="${escapeHtml(imageUrl(f))}" class="${i === galleryIndex ? 'active' : ''}" data-index="${i}" alt="">`).join('')
      : '';
  }
  function galleryGo(step) {
    const n = current.images.length;
    galleryIndex = (galleryIndex + step + n) % n;
    renderGallery();
  }
  document.querySelectorAll('[data-gallery-step]').forEach(b =>
    b.addEventListener('click', () => galleryGo(Number(b.dataset.galleryStep))));
  $('gallery-thumbs').addEventListener('click', e => {
    if (e.target.dataset.index) galleryGo(Number(e.target.dataset.index) - galleryIndex);
  });
  // Swipe on phones
  let touchX = null;
  $('gallery-main').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  $('gallery-main').addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) galleryGo(dx < 0 ? 1 : -1);
  });

  /* Option groups: key in `choices`, label, style and the [value, text] pairs */
  const OPTION_GROUPS = [
    { key: 'sleeves',    label: T.sleeves,    style: 'option', values: [['short', T.shortSleeve], ['long', T.longSleeve]] },
    { key: 'legPockets', label: T.legPockets, style: 'toggle', values: [['yes', T.yes], ['no', T.no]] },
    { key: 'backPocket', label: T.backPocket, style: 'toggle', values: [['yes', T.yes], ['no', T.no]] },
  ];
  function optionGroupHtml(key, label, style, values) {
    const cls = style === 'toggle' ? 'toggle-btn' : 'option-btn';
    const buttons = values.map(([value, text]) =>
      `<button type="button" class="${cls}${choices[key] === value ? ' selected' : ''}" data-key="${key}" data-value="${value}">${text}</button>`).join('');
    return `
      <div class="option-group">
        <div class="option-label">${label} *</div>
        <div class="${style === 'toggle' ? 'toggle-group' : 'option-buttons'}">${buttons}</div>
      </div>`;
  }
  function renderOptions() {
    $('product-options').innerHTML =
      optionGroupHtml('size', T.size, 'option', SIZES.map(s => [s, s])) +
      OPTION_GROUPS.filter(g => current.options.includes(g.key))
        .map(g => optionGroupHtml(g.key, g.label, g.style, g.values)).join('');
  }
  $('product-options').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    choices[b.dataset.key] = b.dataset.value;
    renderOptions();
  });

  function allOptionsChosen() {
    return !!choices.size && OPTION_GROUPS.every(g => !current.options.includes(g.key) || choices[g.key]);
  }

  $('add-to-cart').addEventListener('click', () => {
    if (!allOptionsChosen()) { alert(T.pickAllOptions); return; }
    cart.push({
      cartId: ++nextCartId,
      productId: current.id,
      name: current.name,
      price: current.price,
      size: choices.size,
      sleeves: choices.sleeves || null,
      legPockets: choices.legPockets || null,
      backPocket: choices.backPocket || null,
    });
    updateBadge();
    closeProduct();
    const badge = $('cart-badge');
    badge.classList.add('bump');
    setTimeout(() => badge.classList.remove('bump'), 200);
  });

  /* ── Cart ── */
  /* The cart is kept for this browser tab, so it survives a reload or
     switching between the Italian and English shop */
  const CART_KEY = 'cvb:cart';
  function saveCart() {
    try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* no storage: the cart lives in the page */ }
  }
  function restoreCart() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CART_KEY));
      if (Array.isArray(saved)) cart = saved.filter(item => item && item.productId && item.size);
    } catch (e) { cart = []; }
    nextCartId = cart.reduce((max, item) => Math.max(max, item.cartId || 0), 0);
  }

  // called after every change to the cart
  function updateBadge() {
    const badge = $('cart-badge');
    badge.classList.toggle('hidden', cart.length === 0);
    badge.textContent = cart.length;
    saveCart();
  }

  const yesNo = v => (v === 'yes' ? T.yes : T.no);
  function itemDetails(item) {
    const parts = [T.detailSize + ': ' + item.size];
    if (item.sleeves)    parts.push(T.detailSleeve + ': ' + (item.sleeves === 'short' ? T.short : T.long));
    if (item.legPockets) parts.push(T.detailLegPockets + ': ' + yesNo(item.legPockets));
    if (item.backPocket) parts.push(T.detailBackPocket + ': ' + yesNo(item.backPocket));
    return escapeHtml(parts.join(' · '));
  }
  const cartTotal = () => cart.reduce((sum, item) => sum + item.price, 0);

  function renderCart() {
    const el = $('cart-contents');
    if (cart.length === 0) {
      el.innerHTML = `<div class="cart-empty"><p>${T.cartEmpty}</p>
        <button class="btn-primary" type="button" data-go="catalog">${T.goToCatalog}</button></div>`;
      return;
    }
    el.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-details">${itemDetails(item)}</div>
        </div>
        <div class="cart-item-side">
          <div class="cart-item-price">€${item.price}</div>
          <button class="remove-btn" type="button" data-remove="${item.cartId}" title="${T.remove}" aria-label="${T.remove}">✕</button>
        </div>
      </div>`).join('') + `
      <div class="cart-total">
        <span class="cart-total-label">${T.total}</span>
        <span class="cart-total-amount">€${cartTotal()}</span>
      </div>
      <button class="btn-primary" type="button" data-go="checkout">${T.toCheckout}</button>`;
  }
  $('cart-contents').addEventListener('click', e => {
    const remove = e.target.closest('[data-remove]');
    const go = e.target.closest('[data-go]');
    if (remove) {
      cart = cart.filter(item => item.cartId !== Number(remove.dataset.remove));
      updateBadge();
      renderCart();
    } else if (go && go.dataset.go === 'checkout') {
      showView('checkout');
      setOverlay('notice-overlay', true);   // "Before you continue" notice
    } else if (go) {
      showView(go.dataset.go);
    }
  });

  const closeNotice = () => setOverlay('notice-overlay', false);
  document.querySelectorAll('[data-close-notice]').forEach(b => b.addEventListener('click', closeNotice));
  $('notice-overlay').addEventListener('click', e => { if (e.target.id === 'notice-overlay') closeNotice(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotice(); });

  /* ── Checkout ── */
  const shippingCost = () => (shipping === 'italy' ? shippingCosts.italy : shipping === 'eu' ? shippingCosts.eu : 0);

  function renderSummary() {
    const extra = shipping === 'extra';
    $('checkout-summary').innerHTML = cart.map(item => `
      <div class="summary-item">
        <div>
          <div class="summary-item-name">${escapeHtml(item.name)}</div>
          <div class="summary-item-details">${itemDetails(item)}</div>
        </div>
        <div class="summary-item-price">€${item.price}</div>
      </div>`).join('') + `
      <div class="summary-item">
        <div class="summary-item-name">${SHIPPING_LABELS[shipping]}</div>
        <div class="summary-item-price">${extra ? T.toAgree : '€' + shippingCost()}</div>
      </div>
      <div class="summary-total">
        <span class="summary-total-label">${T.total}${extra ? T.shippingExcluded : ''}</span>
        <span class="summary-total-amount">€${cartTotal() + shippingCost()}</span>
      </div>`;
  }

  function setShipping(method) {
    shipping = method;
    document.querySelectorAll('#shipping-options .option-btn').forEach(b => b.classList.toggle('selected', b.dataset.shipping === method));
    $('shipping-fields').classList.toggle('hidden', method === 'hand');
    $('hand-fields').classList.toggle('hidden', method !== 'hand');
    $('country-group').classList.toggle('hidden', method === 'italy' || method === 'hand');
    $('extra-eu-note').classList.toggle('hidden', method !== 'extra');
    renderSummary();
  }
  document.querySelectorAll('[data-shipping]').forEach(b => b.addEventListener('click', () => setShipping(b.dataset.shipping)));

  function setPaymentMethod(method) {
    paymentMethod = method;
    document.querySelectorAll('#payment-options .toggle-btn').forEach(b => b.classList.toggle('selected', b.dataset.payment === method));
  }
  document.querySelectorAll('[data-payment]').forEach(b => b.addEventListener('click', () => setPaymentMethod(b.dataset.payment)));

  const SHIPPING_INPUTS = ['input-address', 'input-postcode', 'input-city', 'input-phone', 'input-country', 'input-hand'];

  /* Reads and checks the form; returns the order or null (and shows the errors) */
  function readCheckoutForm() {
    const value = id => $(id).value.trim();
    const markError = (inputId, errorId, bad) => {
      $(inputId).classList.toggle('error', bad);
      if (errorId) $(errorId).classList.toggle('hidden', !bad);
      return bad;
    };
    const name = value('input-name');
    const email = value('input-email');
    let valid = true;
    if (markError('input-name', 'error-name', !name)) valid = false;
    if (markError('input-email', 'error-email', !email || !email.includes('@'))) valid = false;

    const byHand = shipping === 'hand';
    const required = byHand ? ['input-hand']
      : ['input-address', 'input-postcode', 'input-city', 'input-phone'].concat(shipping === 'italy' ? [] : ['input-country']);
    SHIPPING_INPUTS.forEach(id => $(id).classList.remove('error'));
    const missing = required.filter(id => !value(id));
    missing.forEach(id => $(id).classList.add('error'));
    $('error-delivery').classList.toggle('hidden', !missing.length);
    if (missing.length) valid = false;
    if (!valid) return null;

    const delivery = { method: shipping };
    if (byHand) {
      delivery.note = value('input-hand');
    } else {
      delivery.address = `${value('input-address')}, ${value('input-postcode')} ${value('input-city')}`;
      delivery.phone = value('input-phone');
      if (shipping !== 'italy') delivery.country = value('input-country');
    }
    return { name, email, notes: value('input-notes'), delivery };
  }

  /* The Apps Script (Code.gs) expects the Italian field names and values below */
  const API_SHIPPING = { italy: 'italia', eu: 'ue', extra: 'extra', hand: 'mano' };
  const API_YES_NO = { yes: 'si', no: 'no' };
  function toApiOrder(order) {
    const delivery = { ...order.delivery, method: API_SHIPPING[order.delivery.method] };
    return {
      action: 'order',
      items: cart.map(item => ({
        cartId: item.cartId,
        productId: item.productId,
        name: item.name,
        price: item.price,
        taglia: item.size,
        maniche: item.sleeves ? { short: 'corta', long: 'lunga' }[item.sleeves] : null,
        tascheGambe: item.legPockets ? API_YES_NO[item.legPockets] : null,
        tascaSchiena: item.backPocket ? API_YES_NO[item.backPocket] : null,
      })),
      name: order.name,
      email: order.email,
      notes: order.notes,
      method: paymentMethod === 'bank' ? 'bonifico' : 'paypal',
      delivery,
      lang: Site.lang,   // language of the summary email and of the error messages
    };
  }

  $('submit-order').addEventListener('click', async () => {
    const order = readCheckoutForm();
    if (!order) return;
    const button = $('submit-order');
    button.disabled = true;
    button.textContent = T.sending;
    try {
      const res = await fetch(PREORDER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // plain text avoids a CORS preflight
        body: JSON.stringify(toApiOrder(order)),
      });
      const data = await res.json();
      if (data.orderId) {
        showPayment({ code: data.orderId, total: data.total, emailSent: data.emailSent, extraEu: !!data.extraUe, email: order.email });
        return;
      }
      alert(data.error || ERROR_TEXT);
    } catch (e) {
      alert(ERROR_TEXT);
    }
    button.disabled = false;
    button.textContent = T.confirm;
  });

  /* ── Order placed: how to pay ── */
  function showPayment({ code, total, emailSent, extraEu, email }) {
    $('order-code').textContent = code;
    $('order-total').textContent = '€' + total + (extraEu ? T.totalExtraEu : '');
    $('email-sent').textContent = emailSent ? T.emailSent(email) : '';
    $('email-sent').classList.toggle('hidden', !emailSent);

    const c = escapeHtml(code);
    const mailLink = `<a href="mailto:${EMAIL}?subject=${encodeURIComponent(T.extraEuSubject + ' ' + code)}">${EMAIL}</a>`;
    const warning = extraEu ? `<p class="pay-warning">${T.extraEuWarning(mailLink, c)}</p>` : '';
    if (paymentMethod === 'paypal') {
      const link = `https://paypal.me/${encodeURIComponent(payment.paypalMe)}` + (extraEu ? '' : `/${total}EUR`);
      $('pay-box').innerHTML = `
        ${warning}<p class="pay-box-title"><strong>${T.payPaypal}</strong></p>
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="btn-primary">${extraEu ? T.goToPaypal : T.payOnPaypal(total)} →</a>
        <p class="fine-print">${T.paypalNote(c)}</p>`;
    } else {
      $('pay-box').innerHTML = `
        ${warning}<p class="pay-box-title"><strong>${T.payBank}</strong></p>
        <div class="bank-details">
          <p>${T.holder}: <strong>${escapeHtml(payment.accountHolder)}</strong></p>
          <p>IBAN: <strong class="copyable">${escapeHtml(payment.iban)}</strong></p>
          <p>${T.amount}: <strong>${extraEu ? T.toAgree : '€' + total}</strong></p>
          <p>${T.reference}: <strong class="copyable">${c}</strong></p>
        </div>`;
    }
    cart = [];
    updateBadge();
    showView('success');
  }

  /* ── Start: preorder status, prices and products from the Sheet ──
     The Sheet takes 1–3 s to answer, so the last catalog seen in this browser
     is shown at once and then replaced by the fresh one. Prices and totals are
     always recalculated by the Apps Script when the order is sent. */
  function applyStatus(status) {
    if (status.shippingCosts) shippingCosts = status.shippingCosts;
    if (status.payment) payment = status.payment;
    const handDeliveryInfo = Site.inLanguage(status.handDeliveryInfo, status.handDeliveryInfoEn) || '';
    $('hand-delivery-text').textContent = handDeliveryInfo;
    $('hand-delivery-box').classList.toggle('hidden', !handDeliveryInfo);
    document.querySelectorAll('.shipping-cost-italy').forEach(el => { el.textContent = shippingCosts.italy; });
    document.querySelectorAll('.shipping-cost-eu').forEach(el => { el.textContent = shippingCosts.eu; });
    products = status.products.map(p => ({ ...p, images: p.images.length ? p.images : ['logo.png'] }));
    // items already in the cart follow the fresh names and prices; products no longer on sale leave the cart
    cart = cart.filter(item => products.some(p => p.id === item.productId));
    cart.forEach(item => { const p = products.find(x => x.id === item.productId); item.name = p.name; item.price = p.price; });
    updateBadge();
    renderProducts();
    if (currentView === 'cart') renderCart();
    if (currentView === 'checkout') renderSummary();
  }

  restoreCart();
  updateBadge();

  const cached = Site.getCachedStatus && Site.getCachedStatus();
  let shownFromCache = false;
  if (cached && cached.isOpen && Array.isArray(cached.products) && cached.products.length) {
    applyStatus(cached);
    showView('catalog');
    shownFromCache = true;
  }

  Site.getPreorderStatus().then(status => {
    if (!status.isOpen) {
      if (status.opensOn) $('closed-text').textContent = T.opensOn(status.opensOn);
      showView('closed');
      return;
    }
    if (!status.products) throw new Error('Apps Script out of date: no products');
    applyStatus(status);
    if (currentView === 'loading' || currentView === 'closed') showView('catalog');
  }).catch(() => {
    if (shownFromCache) return;   // keep the catalog already on screen
    $('closed-text').textContent = T.loadError;
    showView('closed');
  });
})();
