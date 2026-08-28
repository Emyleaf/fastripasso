# Ripasso integrativo

Webapp statica per il ripasso di Diritto ed Economia e Scienze Umane — primo e secondo anno.

## Come usarla

La pagina legge direttamente questi file Markdown:

- `Riassunto finale Diritto ed Economia.md`
- `Domande probabili.md`
- `Scienze Umane - Primo anno.md`
- `Scienze Umane - Secondo anno.md`

Per Diritto ed Economia, la teoria proviene dal riassunto finale e le carte usano esclusivamente le domande elencate in `Domande probabili.md`. Per Scienze Umane, le domande continuano a essere generate automaticamente dalla teoria. Se modifichi i file `.md`, la webapp si aggiorna al successivo caricamento.

## Pubblicazione su GitHub Pages

1. Crea un repository GitHub e carica tutti i file di questa cartella.
2. Vai in **Settings → Pages**.
3. In **Build and deployment**, scegli **Deploy from a branch**, seleziona il branch principale e la cartella `/ (root)`.
4. Apri l'indirizzo GitHub Pages generato.

La webapp è volutamente senza framework, database o servizi a pagamento.

## Anteprima locale

Per un'anteprima locale serve un piccolo server web, perché il browser non permette alla pagina aperta con doppio clic di leggere i file Markdown. In alternativa, il modo più semplice è pubblicarla su GitHub Pages e aprire l'indirizzo generato.
