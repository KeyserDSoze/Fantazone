# Classifica Serie A derivata

Fantazone non migra né persiste la vecchia cache backend `RealRank`.

La classifica reale della Serie A viene calcolata localmente con `buildRealRank()` a partire dal `RealCalendar` canonico già scaricato dal client:

```text
data/serie-a/calendars/<season>.json
        ↓
   buildRealRank()
        ↓
classifica Serie A in memoria
```

## Regole

La proiezione replica la semantica utile del vecchio `SerieAJob.BuildRank`:

- tutte le squadre presenti nel calendario vengono inizializzate anche a zero punti;
- una partita contribuisce solo se non è rinviata, ha una data valida, è già iniziata e ha entrambi i gol valorizzati;
- un risultato live già pubblicato nel `RealCalendar` contribuisce immediatamente alla proiezione;
- vittoria = 3 punti, pareggio = 1 punto, sconfitta = 0;
- ordinamento: punti, differenza reti, gol fatti, meno gol subiti, nome squadra.

La funzione è pura e riceve `now`, quindi è deterministica nei test.

## Perché non esiste più `data/serie-a/rank/...`

Nel backend legacy `RealRank` era un secondo documento aggiornato insieme al calendario. In Fantazone sarebbe una duplicazione dello stesso stato e introdurrebbe un'ulteriore possibilità di desincronizzazione.

Il `RealCalendar` è già il documento canonico condiviso e viene aggiornato giornalmente, oltre al refresh del turno corrente durante le finestre live. La classifica può quindi essere ricostruita in modo economico sul dispositivo senza Action, PAT aggiuntivi o nuove scritture GitHub.

La migrazione Azure continua perciò a trattare il container legacy `realrank` come ritirato: il dato utile è ricostruibile dal calendario migrato.

## UI

La schermata **Live** mostra la classifica completa con:

- posizione;
- partite giocate;
- vittorie, pareggi, sconfitte;
- gol fatti e subiti;
- differenza reti;
- punti.

Durante una giornata in corso il badge indica **Proiezione live**; fuori dalla finestra live la tabella rappresenta lo stato derivato dal calendario canonico disponibile.
