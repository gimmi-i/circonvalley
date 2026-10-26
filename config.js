// ================================================================
//  SITE CONFIGURATION — filled in once.
//  Opening/closing the preorder, prices and products are managed
//  in the Google Sheets, not here.
// ================================================================

// Web App of the merch Google Sheet (Apps Script Code.gs, see PREORDER.md)
const PREORDER_API_URL = "https://script.google.com/macros/s/AKfycbyu8T4DC-waf4OsJlSO0Ue9jTmrZRU7YxZJKyuxHuJBFm_Nji15CpNxdER6N7YLTVk/exec";

// Web App of the "Sito CVB - Gestione Tracce" Sheet (Apps Script Tracce.gs, page tracce/)
const TRACKS_API_URL = "https://script.google.com/macros/s/AKfycbwFiHhpHQ_ozPG1rAXMo2BqA5L3OXNxzu-U8xFO965y6HUMlSiih0p-uPHXRBbhrx1xrA/exec";

// Payment details are read from the merch Sheet (Impostazioni tab).
// These are only a fallback in case the Sheet doesn't provide them.
const PAYMENT_FALLBACK = {
  paypalMe:      "andrevita",          // e.g. "circonvalley" for paypal.me/circonvalley
  iban:          "IT41N0366901600067012785558",
  accountHolder: "Andrea Franceso Vitali",
};
