# Zero-backend push notifications

Fantazone non introduce un server applicativo per le notifiche. Il browser registra la propria Web Push subscription, il repository del gruppo conserva subscription e preferenze leggibili, e un GitHub Actions workflow del gruppo esegue l'invio.

## Perché la VAPID key è globale

Una Web Push subscription è associata all'origine web e all'application server key usata in `PushManager.subscribe()`. Tutti i gruppi usano la stessa origine `https://fanta.plus`, quindi Fantazone usa una sola chiave pubblica VAPID globale. Usare una coppia diversa per ogni gruppo renderebbe incompatibile la stessa subscription quando l'utente passa da un gruppo all'altro.

Fantazone mantiene la chiave pubblica già usata dal client legacy. La chiave privata non viene salvata nel repository piattaforma, nel bundle web, in OneDrive, nel PAT o nei documenti JSON del gruppo.

Ogni repository `Fantazone.<group>` che abilita il trasporto deve configurare il repository Actions Secret:

```text
FANTAZONE_VAPID_PRIVATE_KEY
```

Il valore deve essere la chiave privata corrispondente alla chiave pubblica globale già in uso. Il valore non deve essere aggiunto a file versionati.

## Stato canonico del gruppo

Le preferenze e le subscription sono group-owned e vengono salvate in:

```text
data/push/users/<hex-email-normalizzata>.json
```

Il documento contiene proprietà leggibili:

```json
{
  "version": 1,
  "email": "utente@example.com",
  "matchEvents": true,
  "opponentMatchEvents": false,
  "deploymentReminder": true,
  "endDay": false,
  "marketEvents": true,
  "subscriptions": [
    {
      "endpoint": "https://push-provider.example/...",
      "p256dh": "...",
      "auth": "...",
      "createdAt": "2026-09-07T08:00:00.000Z"
    }
  ]
}
```

Endpoint e chiavi della subscription non sono password dell'account, ma sono comunque dati operativi del singolo dispositivo e restano nel repository privato del gruppo.

## Browser

Il web client registra `/fantazone-push-sw.js` e usa la chiave pubblica globale per `PushManager.subscribe()`.

La schermata **Notifiche push** permette di:

- richiedere il permesso browser;
- registrare o rimuovere il dispositivo corrente;
- salvare le cinque preferenze legacy;
- verificare lo stato del trasporto GitHub Actions;
- inviare una notifica di prova.

Il Service Worker mostra il payload e, al click, apre o porta in primo piano `fanta.plus`.

## Trasporto nel repository gruppo

Un SuperAdmin può installare/aggiornare due file gestiti:

```text
.github/workflows/fantazone-push.yml
.github/fantazone/push-sender.mjs
```

Il workflow manuale riceve destinatario, titolo, corpo e URL. Lo script legge solo il documento push del destinatario nel repository del gruppo, cifra il payload Web Push con `aes128gcm` e firma VAPID usando `FANTAZONE_VAPID_PRIVATE_KEY` dall'ambiente Actions.

Il trasporto non enumera altri gruppi e il repository piattaforma non conserva PAT o subscription di gruppi esterni.

## Sequenza di attivazione

Prima di abilitare qualsiasi automazione:

1. installare il trasporto dal SuperAdmin;
2. configurare `FANTAZONE_VAPID_PRIVATE_KEY` in **Settings → Secrets and variables → Actions** del repository gruppo;
3. registrare un browser da `https://fanta.plus`;
4. premere **Invia notifica di prova**;
5. verificare il run nella schermata Log/GitHub Actions e la ricezione sul dispositivo;
6. solo dopo un test reale riuscito, abilitare gradualmente reminder ed eventi automatici.

Questa sequenza è intenzionale: evita di trasformare una migrazione del trasporto in spam o notifiche duplicate.

## Automazioni

La V1 porta infrastruttura, preferenze, subscription e test manuale. Gli invii automatici legacy restano inizialmente disabilitati:

- eventi dei propri giocatori;
- eventi dell'avversario;
- reminder formazione;
- fine giornata;
- mercato.

Il primo candidato da riattivare è il reminder formazione, perché dipende solo dal prossimo kickoff del RealCalendar e può essere deduplicato con un marker group-owned. Gli eventi live richiedono invece un checkpoint per confrontare i voti live globali senza duplicazioni.

## Native

Questa V1 riguarda Web Push. iOS/Android nativi richiedono il trasporto Expo/APNs/FCM e una validazione su build/dev-client reali. La schermata non dichiara le notifiche native come completate finché quel percorso non è validato.
