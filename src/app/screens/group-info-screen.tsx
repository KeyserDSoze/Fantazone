import React from 'react'
import { Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'

export function GroupInfoScreen() {
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={940} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Guida a Fantazone</H1>
          <Paragraph color="$color10">Come leggere formazione, Live, mercato e dati del gruppo nella versione senza backend.</Paragraph>
        </YStack>

        <GuideCard title="Formazione e TeamDay">
          <GuideLine title="Squadra corrente">La schermata Formazione modifica sempre il Team della stagione corrente.</GuideLine>
          <GuideLine title="Snapshot immutabile">Quando salvi, una GitHub Action usa il timestamp del commit per stabilire la giornata eleggibile e crea il TeamDay. Una giornata già iniziata non viene riscritta.</GuideLine>
          <GuideLine title="Posizioni">Titolari: 11. Portiere: titolare + riserva. Difesa, centrocampo e attacco hanno prima/seconda riserva; gli altri giocatori restano in tribuna.</GuideLine>
        </GuideCard>

        <GuideCard title="Partita e Live">
          <GuideLine title="Voto live">Durante le partite Fantazone usa lo snapshot live disponibile e aggiorna proiezioni, sostituzioni, bonus/malus e classifica.</GuideLine>
          <GuideLine title="Voto ufficiale">Quando il voto ufficiale è disponibile ha precedenza sul live. I risultati definitivi vengono ricalcolati dai reducer condivisi usati anche dalle Actions.</GuideLine>
          <GuideLine title="TeamDay storico">Aprendo una partita già chiusa vedi la formazione congelata di quella giornata, non la rosa corrente modificata in seguito.</GuideLine>
        </GuideCard>

        <GuideCard title="Classifica e fortuna">
          <GuideLine title="Classifica">Punti, partite, gol fatti/subiti e fantapunti derivano dal Calendar canonico della lega.</GuideLine>
          <GuideLine title="Parametro Fortuna">Il valore 🍀 misura eventi favorevoli o sfavorevoli rispetto ai punteggi del turno. Toccalo nella Classifica per vedere gli eventi che compongono il totale.</GuideLine>
        </GuideCard>

        <GuideCard title="Mercato">
          <GuideLine title="Proposta">Seleziona giocatori dello stesso ruolo tra le due squadre ed eventuali conguagli.</GuideLine>
          <GuideLine title="Voto">Se la lega usa il mercato con voto, gli altri partecipanti possono approvare o rifiutare fino al quorum.</GuideLine>
          <GuideLine title="Zero backend">Il browser non trasferisce direttamente i giocatori: salva un comando append-only. La GitHub Action rilegge Team, budget, ruoli e stato mercato prima di applicarlo.</GuideLine>
        </GuideCard>

        <GuideCard title="Repository del gruppo e sicurezza">
          <GuideLine title="Fonte canonica">Ogni gruppo vive nel proprio repository Fantazone.*. Calendar, Rank, Team, TeamDay, mercato, Hall of Fame e asta usano JSON leggibili.</GuideLine>
          <GuideLine title="PAT condiviso">Nell’architettura attuale il token GitHub del gruppo è necessariamente disponibile al client e viene sincronizzato nelle impostazioni private OneDrive. Trattalo come una password del gruppo.</GuideLine>
          <GuideLine title="Inviti">Un link di invito che contiene la credenziale del gruppo va condiviso solo con la persona invitata.</GuideLine>
        </GuideCard>

        <GuideCard title="Ruoli amministrativi">
          <GuideLine title="Admin">Può gestire l’asta e le funzioni amministrative abilitate al gruppo.</GuideLine>
          <GuideLine title="SuperAdmin">Può gestire utenti, basket, leghe, impostazioni e ricalcoli. Le operazioni distruttive sono bloccate quando lascerebbero documenti canonici orfani.</GuideLine>
        </GuideCard>
      </YStack>
    </ScrollView>
  )
}

function GuideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4">
      <YStack gap="$3"><H2 size="$6">{title}</H2>{children}</YStack>
    </Card>
  )
}

function GuideLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <XStack gap="$3" alignItems="flex-start" flexWrap="wrap">
      <Text width={150} fontWeight="800">{title}</Text>
      <Paragraph flex={1} minWidth={220} color="$color10">{children}</Paragraph>
    </XStack>
  )
}
