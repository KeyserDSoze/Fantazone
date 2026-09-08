import React from 'react'
import { Paragraph, Text, XStack, YStack } from 'tamagui'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import { APP_VERSION, RELEASE_DATE } from '../config/version'

type ReleaseCategory = 'Nuovo' | 'Miglioria' | 'Fix' | 'Architettura'
type Release = {
  version: string
  date: string
  title: string
  items: Array<{ category: ReleaseCategory; text: string }>
}

const releases: Release[] = [
  {
    version: APP_VERSION,
    date: RELEASE_DATE,
    title: 'Fantazone, ridisegnato con Tamagui',
    items: [
      { category: 'Nuovo', text: 'Introdotto un design system Tamagui condiviso con AppScreen, PageIntro, Surface, FeatureCard, StatusPill e azioni primarie coerenti su web, tablet e mobile.' },
      { category: 'Miglioria', text: 'La shell desktop usa una sidebar persistente con contesto lega/stagione; mobile e tablet usano un header compatto con drawer touch-friendly.' },
      { category: 'Miglioria', text: 'Login, selezione gruppo, onboarding GitHub, Home, Calendario, Classifica, Live, Squadre, Giocatori, Mercato, Regolamento, Impostazioni, Notifiche, Hall of Fame e guida sono stati riallineati allo stesso linguaggio visuale.' },
      { category: 'Miglioria', text: 'Formazione e dettaglio partita sono diventati viste prodotto complete: contesto match, validazione, proposta automatica, immagini giocatori, scoreboard, voti e stati Live più leggibili.' },
      { category: 'Miglioria', text: 'Asta ridisegnata come console realtime: giocatore corrente, foto, offerta leader, timer grande, incrementi rapidi, stato WebRTC e controlli host separati.' },
      { category: 'Miglioria', text: 'Le schermate SuperAdmin di utenti, basket/squadre, leghe/calcoli, Serie A e log GitHub Actions ora usano lo stesso sistema responsive del resto dell’app e isolano chiaramente le azioni distruttive.' },
      { category: 'Miglioria', text: 'Lo stato offline/sync resta discreto in basso a sinistra e si espande soltanto mentre Fantazone sta realmente eseguendo un’operazione.' },
      { category: 'Fix', text: 'Le intestazioni principali espongono nuovamente la semantica accessibile corretta sul web, mantenendo verdi gli smoke test Playwright della login e della shell offline.' },
      { category: 'Architettura', text: 'Versione, marker pubblico e patch notes tornano a essere aggiornati come parte esplicita di ogni rilascio, invece di restare scollegati dallo sviluppo.' },
    ],
  },
  {
    version: '0.2.2',
    date: '8 settembre 2026',
    title: 'Replica offline incrementale',
    items: [
      { category: 'Fix', text: 'Un reload o Ctrl+F5 non riscrive più l’intero snapshot del gruppo quando la revisione GitHub non è cambiata.' },
      { category: 'Miglioria', text: 'All’apertura viene controllato prima il piccolo manifest di revisione; il pacchetto completo del gruppo viene scaricato soltanto quando serve.' },
      { category: 'Architettura', text: 'La revisione dell’ultimo snapshot installato con successo è tracciata separatamente dalla cache del manifest, così un download fallito resta correttamente da ritentare.' },
      { category: 'Fix', text: 'Uno snapshot generato da una Action ma ancora indietro rispetto al manifest remoto non viene applicato: Fantazone conserva la replica locale precedente finché il nuovo pack non è coerente.' },
      { category: 'Miglioria', text: 'I pacchetti Serie A continuano a essere controllati per hash e vengono aggiornati solo quando cambia davvero il relativo contenuto.' },
    ],
  },
  {
    version: '0.2.1',
    date: '8 settembre 2026',
    title: 'Apertura automatica e aggiornamenti applicativi',
    items: [
      { category: 'Miglioria', text: 'Se l’account ha un solo gruppo, Fantazone lo apre automaticamente senza mostrare ogni volta il selettore.' },
      { category: 'Nuovo', text: 'Con più gruppi puoi scegliere un gruppo predefinito: la preferenza viene salvata nei settings privati OneDrive e si apre automaticamente agli avvii successivi.' },
      { category: 'Miglioria', text: 'Il comando Cambia gruppo nel menu interno apre intenzionalmente il selettore senza essere subito rimandato al gruppo predefinito.' },
      { category: 'Nuovo', text: 'Quando viene pubblicata una nuova versione, un banner propone Aggiorna ora o Più tardi; l’aggiornamento svuota solo la cache dell’App Shell e conserva replica offline, gruppi e outbox.' },
      { category: 'Architettura', text: 'I settings utente passano allo schema v3 mantenendo migrazione automatica dai formati v1/v2 e una sola preferenza predefinita valida.' },
    ],
  },
  {
    version: '0.2.0',
    date: '8 settembre 2026',
    title: 'Offline-first e UI riallineata a Fantasoccer',
    items: [
      { category: 'Miglioria', text: 'Header principale riallineato alla UI di Fantasoccer: logo compatto, menu hamburger e utility raccolte nel menu.' },
      { category: 'Miglioria', text: 'Lo stato delle operazioni non occupa più spazio nella pagina: durante il lavoro compare un loader in sovraimpressione in basso a sinistra; offline, modifiche pendenti e ultimo sync restano in un chip compatto.' },
      { category: 'Miglioria', text: 'La sincronizzazione dei gruppi privati usa un unico offline pack deterministico e conserva la copia locale quando la rete non è disponibile.' },
      { category: 'Fix', text: 'Corretta l’idratazione offline dei repository privati evitando i redirect CORS del download archivio.' },
      { category: 'Fix', text: 'I repository migrati che contengono già config/group.json valido possono completare l’inizializzazione Fantazone senza sovrascrivere i dati importati.' },
      { category: 'Nuovo', text: 'Versione applicativa centralizzata e visibile nel menu; le patch notes tornano a descrivere sia ciò che è stato rilasciato sia i prossimi gate.' },
    ],
  },
  {
    version: '0.1.0',
    date: '7 settembre 2026',
    title: 'Fantazone zero-backend',
    items: [
      { category: 'Nuovo', text: 'Nuova shell prodotto con Home, Calendario, Classifica, Live, Formazione, Squadre e Giocatori.' },
      { category: 'Nuovo', text: 'Dettaglio partita con TeamDay congelate, sostituzioni, voti live/ufficiali, bonus, punteggi e gol.' },
      { category: 'Nuovo', text: 'Mercato con proposte, storico, voto e annullamento tramite comandi append-only rivalidati dalle GitHub Actions.' },
      { category: 'Nuovo', text: 'Hall of Fame e Parametro Fortuna integrati nella UI.' },
      { category: 'Nuovo', text: 'Gestione SuperAdmin di utenti, basket, squadre e leghe con controlli di integrità fail-closed.' },
      { category: 'Miglioria', text: 'La Formazione salva sempre il Team corrente; la giornata dello snapshot viene determinata dal timestamp Git del commit.' },
      { category: 'Architettura', text: 'Rimosse le dipendenze runtime dal backend legacy: dati di gruppo su JSON canonici GitHub, calcoli condivisi e Actions group-owned.' },
      { category: 'Architettura', text: 'Login Microsoft + impostazioni private OneDrive per i gruppi e la credenziale GitHub condivisa, coerentemente con il vincolo zero-backend.' },
    ],
  },
]

const roadmap = [
  {
    title: 'OAuth Microsoft su device reali',
    text: 'Registrare e verificare i redirect Entra mobile/desktop e chiudere l’acceptance reale su iOS e Android.',
  },
  {
    title: 'Feed live e voti finali',
    text: 'Ottenere una osservazione positiva del feed durante una partita attiva e abilitare lo scheduling automatico dei voti finali.',
  },
  {
    title: 'Push end-to-end',
    text: 'Validare una consegna Web Push reale con il secret VAPID, poi completare orchestrazione automatica e push nativo.',
  },
  {
    title: 'Asta multi-device',
    text: 'Eseguire test reali tra più dispositivi, completare il percorso TURN e verificare reconnect e recovery durante una sessione lunga.',
  },
  {
    title: 'Acceptance nativa',
    text: 'Fare il pass finale su iOS/Android reali per safe area, tastiera, touch target, icone/adaptive icon e installazione PWA/native.',
  },
]

export function GroupPatchNotesScreen() {
  return (
    <AppScreen maxWidth={1040}>
      <PageIntro
        eyebrow={`Versione ${APP_VERSION}`}
        title="Patch notes"
        description="Cosa è entrato davvero in Fantazone e quali gate operativi restano da chiudere."
      />

      <YStack gap="$4">
        {releases.map((release, releaseIndex) => (
          <Surface key={release.version} accent={releaseIndex === 0 ? 'blue' : 'neutral'} padding="$5">
            <YStack gap="$4">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
                <YStack gap="$1" flex={1} minWidth={240}>
                  <XStack alignItems="center" gap="$2" flexWrap="wrap">
                    <Text color="$color12" fontSize="$6" fontWeight="900">{release.title}</Text>
                    {releaseIndex === 0 ? <StatusPill tone="green">Corrente</StatusPill> : null}
                  </XStack>
                  <Text color="$color9">v{release.version}</Text>
                </YStack>
                <Text color="$color9" fontSize="$2" fontWeight="700">{release.date}</Text>
              </XStack>

              <YStack gap="$3">
                {release.items.map((item, index) => (
                  <XStack key={`${release.version}-${item.category}-${index}`} gap="$3" alignItems="flex-start" flexWrap="wrap">
                    <StatusPill tone={categoryTone(item.category)}>{item.category}</StatusPill>
                    <Paragraph flex={1} minWidth={240} color="$color10" lineHeight="$5">{item.text}</Paragraph>
                  </XStack>
                ))}
              </YStack>
            </YStack>
          </Surface>
        ))}
      </YStack>

      <YStack gap="$3" paddingTop="$2">
        <YStack gap="$1">
          <Text color="$color12" fontSize="$7" fontWeight="900">Da fare / In arrivo</Text>
          <Paragraph color="$color10">Questi sono i gate operativi ancora aperti dopo il refactoring e il redesign.</Paragraph>
        </YStack>
        <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
          {roadmap.map((item, index) => (
            <YStack
              key={item.title}
              flexGrow={1}
              flexBasis={300}
              minWidth={260}
              padding="$4"
              gap="$2"
              borderWidth={1}
              borderColor="$color5"
              backgroundColor="$color2"
              borderRadius="$5"
            >
              <Text color="$blue10" fontSize="$2" fontWeight="900">GATE {index + 1}</Text>
              <Text color="$color12" fontSize="$5" fontWeight="900">{item.title}</Text>
              <Paragraph color="$color10" lineHeight="$5">{item.text}</Paragraph>
            </YStack>
          ))}
        </XStack>
      </YStack>
    </AppScreen>
  )
}

function categoryTone(category: ReleaseCategory): 'blue' | 'green' | 'yellow' | 'purple' {
  switch (category) {
    case 'Nuovo': return 'green'
    case 'Miglioria': return 'blue'
    case 'Fix': return 'yellow'
    case 'Architettura': return 'purple'
  }
}
