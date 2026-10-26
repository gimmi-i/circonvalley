// ================================================================
//  CONFIGURAZIONE PREORDER — si compila UNA volta sola.
//  Aprire/chiudere il preorder si fa dal Google Sheet.
// ================================================================

// Indirizzo della Web App di Google Apps Script (vedi PREORDER.md)
const API_URL = "https://script.google.com/macros/s/AKfycbyu8T4DC-waf4OsJlSO0Ue9jTmrZRU7YxZJKyuxHuJBFm_Nji15CpNxdER6N7YLTVk/exec";

// Dati per i pagamenti: ora si leggono dal Google Sheet (tab Impostazioni).
// Questi qui sotto servono solo come riserva se lo Sheet non li fornisce.
const PAGAMENTI = {
  paypalMe:     "andrevita",          // es. "circonvalley" per paypal.me/circonvalley
  iban:         "IT41N0366901600067012785558",
  intestatario: "Andrea Franceso Vitali",
};
