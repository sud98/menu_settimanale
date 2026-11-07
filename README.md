# Menù di Casa

Web app che prepara il menu della settimana e, a ogni uso, impara i gusti della famiglia.
È **tutto gratuito**: niente AI a pagamento, l'apprendimento avviene nel browser.
Usa la stessa tecnica di GE WoodArt: HTML e JavaScript senza build, Supabase come database,
GitHub Pages per la pubblicazione e l'installazione sul telefono come app.

## Come impara

Ogni gesto diventa un "segnale" salvato nella tabella `eventi`:

| Gesto | Peso |
|---|---|
| ★ dopo aver mangiato (1–5) | da −1.5 a +1.5 (il più importante) |
| 👍 / 👎 | +1 / −1.5 |
| Scegliere voi un piatto (✎) | +0.6 |
| Confermare il menu | +0.3 per ogni piatto |
| Chiedere un altro piatto (↻) | −0.4 |

Da questi segnali l'app calcola quanto vi piace **ogni piatto** e anche le sue **caratteristiche**:
tipo (pesce, legumi…), tag (veloce, forno…) e ingredienti. Se vi piacciono tre piatti con le zucchine,
salgono anche gli altri piatti con le zucchine. I voti vecchi pesano meno: dopo 4 mesi valgono la metà.

Quando genera un menu, l'app combina:

- i vostri gusti;
- il tempo massimo di preparazione (diverso tra feriali e weekend);
- la stagione;
- i piatti mangiati di recente, che non ripropone;
- un equilibrio settimanale (almeno 2 pasti di pesce e 2 di legumi, carne rossa al massimo 1 volta…);
- un po' di casualità, così il menu non è sempre uguale. La "voglia di novità" nel profilo regola quanto propone piatti mai provati.

Nella sezione **Gusti** vedete cosa ha imparato.

## Provarla sul PC

```bash
py -m http.server 5173
```

Poi aprite http://localhost:5173. Senza Supabase i dati restano nel browser.

## Collegare Supabase (gratuito)

1. Su https://supabase.com create un nuovo progetto (va bene il piano Free).
2. Aprite **SQL Editor → New query**, incollate il contenuto di `supabase/schema.sql` e premete **Run**.
3. In **Project Settings → API Keys** copiate il *Project URL* e la *Publishable key*.
4. Incollateli in `config.js`.

Al primo avvio con il database vuoto, l'app ci carica il ricettario iniziale e quello che avevate già nel browser.

> Come per GE WoodArt non c'è login: chi conosce l'indirizzo del sito può vedere e modificare i dati.
> Se in futuro serve, si può aggiungere un accesso con email e password.
>
> Sul piano Free, Supabase mette in pausa il progetto dopo 7 giorni senza utilizzo. Se succede, basta riattivarlo dalla dashboard.

## Assistente AI gratuito (Google Gemini)

L'assistente si aggiunge all'algoritmo, non lo sostituisce:

- **Menu → "✨ Chiedi all'assistente"**: scrivete cosa volete ("più leggero", "giovedì qualcosa di veloce",
  "usiamo le zucchine", "fammi un menu nuovo"). L'assistente cambia i pasti e, se serve, inventa piatti nuovi
  con ingredienti e preparazione, che entrano nel ricettario.
- **Piatti → "✨ Idee"**: propone piatti che non avete ancora; scegliete voi quali aggiungere.
- Riceve sempre profilo, gusti imparati e le ultime richieste, così le proposte migliorano col tempo.
- I piatti nuovi poi vengono votati e imparati come tutti gli altri.

Per attivarlo (tutto dal sito, senza installare niente):

1. **Chiave Gemini**: su https://aistudio.google.com/apikey accedete con un account Google e premete
   *Create API key*. È gratuita, non serve la carta di credito.
2. **Secret su Supabase**: *Edge Functions → Secrets* → aggiungete `GEMINI_API_KEY` con la chiave appena creata.
3. **Funzione**: *Edge Functions → Deploy a new function → Via Editor*, chiamatela esattamente `menu-ai`,
   incollate tutto il contenuto di `supabase/functions/menu-ai/index.ts` e premete *Deploy*.
4. Nella pagina della funzione, in *Details*, **disattivate "Verify JWT with legacy secret"**
   (o "Enforce JWT verification"): l'app non usa il login, come GE WoodArt.
5. Ricaricate l'app: la casella "Chiedi all'assistente" compare quando l'app è collegata a Supabase.

Note:
- Il piano gratuito ha un limite di richieste al giorno; per una famiglia è più che sufficiente.
  Se si supera, l'app lo dice e basta riprovare più tardi.
- Sul piano gratuito Google può usare le richieste per migliorare i suoi servizi (si tratta solo di menu e gusti).
- Il modello predefinito è `gemini-flash-latest`. Per cambiarlo aggiungete il secret `GEMINI_MODEL`.

## Pubblicarla su GitHub Pages

Tutti i file del sito stanno nella cartella principale, come in GE WoodArt,
così si caricano dal sito di GitHub senza problemi di sottocartelle.

1. Nel repository: **Add file → Upload files**, selezionate tutti i file della cartella principale
   (non servono `supabase/`, `.claude/` e `.github/`) e premete **Commit changes**.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, cartella `/ (root)`, **Save**.
3. Il sito è su `https://sud98.github.io/menu_settimanale/`.
4. Dal telefono aprite il sito e scegliete "Aggiungi a schermata Home".

Dopo una modifica ai file conviene alzare la versione in `sw.js` (`menu-di-casa-v3` → `v4`):
così i telefoni scaricano subito la versione nuova.

## File

| File | Cosa contiene |
|---|---|
| `index.html`, `style.css` | pagina e stile (chiaro/scuro automatico) |
| `app.js` | schermate: Menu, Spesa, Piatti, Gusti, Profilo |
| `engine.js` | generazione del menu e apprendimento |
| `store.js` | salvataggio su Supabase oppure nel browser |
| `ai.js` | richieste all'assistente AI |
| `supabase/functions/menu-ai/index.ts` | Edge Function che parla con Gemini (la chiave resta su Supabase) |
| `seed.js` | ricettario iniziale (circa 90 piatti, tutti modificabili dall'app) |
| `config.js` | dati di collegamento a Supabase |
| `supabase/schema.sql` | tabelle da creare su Supabase |
| `sw.js`, `manifest.json`, `icon-*.png` | installazione sul telefono e uso senza rete |
