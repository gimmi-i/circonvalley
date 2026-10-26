# Gestione preorder merch

Tutto si gestisce da un **Google Sheet**: da lì apri e chiudi il preorder,
cambi i prezzi e trovi gli ordini. I pagamenti arrivano su PayPal o con bonifico.

## Uso normale
1. Tab **Impostazioni**: scrivi `data_chiusura` e spunta `preorder_aperto`
2. Il preorder si chiude da solo a fine giornata della `data_chiusura`
3. Tab **Ordini**: una riga per prodotto. Quando ricevi un pagamento, cerca il
   codice ordine (es. CV1017-AB12, è nella causale o nel messaggio PayPal) e
   spunta **Pagato** su tutte le sue righe.
4. A preorder chiuso, filtra per Pagato = ✓ e manda i numeri al produttore.

## Configurazione iniziale (una volta)
1. Crea un Google Sheet (sheets.new) con l'account del collettivo
2. Estensioni → Apps Script → incolla il contenuto di `Code.gs` → salva
3. Seleziona la funzione `setup` → ▶ Esegui → autorizza
   (Avanzate → Vai a … non sicuro → Consenti)
4. Esegui il deployment → Nuovo deployment → ⚙️ App web →
   Esegui come: Me · Chi ha accesso: Chiunque → copia l'URL `/exec`
5. Su GitHub modifica `config.js`: incolla l'URL in `PREORDER_API_URL`
   (PayPal.me e IBAN si scrivono nello Sheet, tab Impostazioni)

Se modifichi `Code.gs`: Esegui il deployment → Gestisci deployment → ✏️ →
Versione: Nuova versione (così l'URL non cambia).
