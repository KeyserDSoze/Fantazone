import React from 'react'
import { Card, H1, H2, Paragraph, ScrollView, Separator, Text, XStack, YStack } from 'tamagui'
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
    title: 'Apertura automatica e gruppo predefinito',
    items: [
      { category: 'Miglioria', text: 'Se l’account ha un solo gruppo, Fantazone lo apre automaticamente senza mostrare ogni volta il selettore.' },
      { category: 'Nuovo', text: 'Con più gruppi puoi scegliere un gruppo predefinito: la preferenza viene salvata nei settings privati OneDrive e si apre automaticamente agli avvii successivi.' },
      { category: 'Miglioria', text: 'Il comando Cambia gruppo nel menu interno apre intenzionalmente il selettore senza essere subito rimandato al gruppo predefinito.' },
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
      { category: 'Miglioria', text: 'Live e dettaglio partita forzano letture fresche solo dei documenti che cambiano durante la giornata, senza invalidare l’intero repository.' },
      { category: 'Miglioria', text: 'Il generatore Calendar iniziale è deterministico: un retry produce gli stessi accoppiamenti e può riparare un Rank mancante.' },
      { category: 'Architettura', text: 'Rimosse le dipendenze runtime dal backend legacy: dati di gruppo su JSON canonici GitHub, calcoli condivisi e Actions group-owned.' },
      { category: 'Architettura', text: 'Team corrente normalizzato per playerKey; TeamDay mantiene snapshot completi e immutabili per la correttezza storica.' },
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
    text: 'Eseguire test reali tra più dispositivi, completare il percorso TURN e rifinire la UX realtime.',
  },
]

export function GroupPatchNotesScreen() {
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={900} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <Text fontSize="$2" fontWeight="800" color="$blue10">VERSIONE {APP_VERSION}</Text>
          <H1>Patch notes</H1>
          <Paragraph color="$color10">Cosa è entrato nell’app e quali sono i prossimi gate ancora da chiudere.</Paragraph>
        </YStack>

        {releases.map(release => (
          <Card key={release.version} borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
                <YStack>
                  <H2 size="$6">{release.title}</H2>
                  <Text color="$color10">v{release.version}</Text>
                </YStack>
                <Text color="$color10">{release.date}</Text>
              </XStack>
              <YStack gap="$2">
                {release.items.map((item, index) => (
                  <XStack key={`${release.version}-${item.category}-${index}`} gap="$3" alignItems="flex-start" flexWrap="wrap">
                    <Text
                      width={100}
                      fontWeight="800"
                      color={item.category === 'Nuovo' ? '$green10' : item.category === 'Miglioria' ? '$blue10' : item.category === 'Fix' ? '$orange10' : '$purple10'}
                    >
                      {item.category}
                    </Text>
                    <Paragraph flex={1} minWidth={220} color="$color10">{item.text}</Paragraph>
                  </XStack>
                ))}
              </YStack>
            </YStack>
          </Card>
        ))}

        <Separator marginVertical="$2" />

        <YStack gap="$2">
          <H2>Da fare / In arrivo</H2>
          <Paragraph color="$color10">Gate operativi ancora aperti dopo il refactoring applicativo.</Paragraph>
        </YStack>

        <YStack gap="$2">
          {roadmap.map(item => (
            <Card key={item.title} borderWidth={1} borderColor="$borderColor" padding="$3">
              <YStack gap="$1">
                <Text fontWeight="800">{item.title}</Text>
                <Paragraph color="$color10">{item.text}</Paragraph>
              </YStack>
            </Card>
          ))}
        </YStack>
      </YStack>
    </ScrollView>
  )
}
