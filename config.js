// ================================================================
//  CONFIGURAZIONE PREORDER — si compila UNA volta sola.
//  Aprire/chiudere il preorder si fa dal Google Sheet.
// ================================================================

// Indirizzo della Web App di Google Apps Script (vedi PREORDER.md)
const API_URL = "https://script.google.com/macros/s/AKfycbwYxRBuJ8QB3YeSjz-SHkgDSiejtXcccnjE1B9OPQVJLXhC50U951WsdbGP5Nwd2ZI/exec";

// Dati per i pagamenti, mostrati dopo l'ordine
const PAGAMENTI = {
  paypalMe:     "andrevita",          // es. "circonvalley" per paypal.me/circonvalley
  iban:         "IT00 X000 0000 0000 0000 0000 000",
  intestatario: "Andrea Franceso Vitali",
};
