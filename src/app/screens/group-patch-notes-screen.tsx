import React from 'react'
import { Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'

type Release = {
  version: string
  date: string
  title: string
  items: Array<{ category: 'Nuovo' | 'Miglioria' | 'Architettura'; text: string }>
}

const releases: Release[] = [
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

export function GroupPatchNotesScreen() {
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={900} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Patch notes</H1>
          <Paragraph color="$color10">Le modifiche principali della nuova applicazione Fantazone.</Paragraph>
        </YStack>
        {releases.map(release => (
          <Card key={release.version} borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
                <YStack><H2 size="$6">{release.title}</H2><Text color="$color10">v{release.version}</Text></YStack>
                <Text color="$color10">{release.date}</Text>
              </XStack>
              <YStack gap="$2">
                {release.items.map((item, index) => (
                  <XStack key={`${item.category}-${index}`} gap="$3" alignItems="flex-start" flexWrap="wrap">
                    <Text width={100} fontWeight="800" color={item.category === 'Nuovo' ? '$green10' : item.category === 'Miglioria' ? '$blue10' : '$purple10'}>{item.category}</Text>
                    <Paragraph flex={1} minWidth={220} color="$color10">{item.text}</Paragraph>
                  </XStack>
                ))}
              </YStack>
            </YStack>
          </Card>
        ))}
      </YStack>
    </ScrollView>
  )
}
