// ================================================================
//  CONFIGURAZIONE PREORDER — si compila UNA volta sola.
//  Aprire/chiudere il preorder si fa dal Google Sheet.
// ================================================================

// Indirizzo della Web App di Google Apps Script (vedi PREORDER.md)
const API_URL = "INCOLLA_QUI_URL_WEB_APP";

// Dati per i pagamenti, mostrati dopo l'ordine
const PAGAMENTI = {
  paypalMe:     "NOME_PAYPAL_ME",          // es. "circonvalley" per paypal.me/circonvalley
  iban:         "IT00 X000 0000 0000 0000 0000 000",
  intestatario: "Nome Cognome",
};
