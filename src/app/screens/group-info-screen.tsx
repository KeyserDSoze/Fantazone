import React from 'react'
import {
  BookOpen,
  Github,
  Landmark,
  LineChart,
  ShieldCheck,
  UsersRound,
} from '@tamagui/lucide-icons-2'
import { Paragraph, Text, XStack, YStack } from 'tamagui'
import { AppScreen, PageIntro, Surface } from '../components/design-system'

export function GroupInfoScreen() {
  return (
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow="Come funziona"
        title="Guida a Fantazone"
        description="Una panoramica pratica di formazione, Live, mercato, dati e sicurezza nella versione offline-first senza backend Fantazone."
      />

      <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
        <GuideCard icon={<UsersRound size="$1.2" color="$blue10" />} title="Formazione e TeamDay">
          <GuideLine title="Squadra corrente">La schermata Formazione modifica sempre il Team della stagione corrente.</GuideLine>
          <GuideLine title="Snapshot immutabile">Quando salvi, una GitHub Action usa il timestamp del commit per stabilire la giornata eleggibile e crea il TeamDay. Una giornata già iniziata non viene riscritta.</GuideLine>
          <GuideLine title="Posizioni">Titolari: 11. Portiere: titolare + riserva. Difesa, centrocampo e attacco hanno prima/seconda riserva; gli altri giocatori restano in tribuna.</GuideLine>
        </GuideCard>

        <GuideCard icon={<LineChart size="$1.2" color="$green10" />} title="Partita e Live">
          <GuideLine title="Voto live">Durante le partite Fantazone usa lo snapshot live disponibile e aggiorna proiezioni, sostituzioni, bonus/malus e classifica.</GuideLine>
          <GuideLine title="Voto ufficiale">Quando il voto ufficiale è disponibile ha precedenza sul live. I risultati definitivi vengono ricalcolati dai reducer condivisi usati anche dalle Actions.</GuideLine>
          <GuideLine title="TeamDay storico">Aprendo una partita già chiusa vedi la formazione congelata di quella giornata, non la rosa corrente modificata in seguito.</GuideLine>
        </GuideCard>

        <GuideCard icon={<Landmark size="$1.2" color="$purple10" />} title="Classifica e fortuna">
          <GuideLine title="Classifica">Punti, partite, gol fatti/subiti e fantapunti derivano dal Calendar canonico della lega.</GuideLine>
          <GuideLine title="Parametro Fortuna">Il valore 🍀 misura eventi favorevoli o sfavorevoli rispetto ai punteggi del turno. Toccalo nella Classifica per vedere gli eventi che compongono il totale.</GuideLine>
        </GuideCard>

        <GuideCard icon={<BookOpen size="$1.2" color="$yellow10" />} title="Mercato">
          <GuideLine title="Proposta">Seleziona giocatori dello stesso ruolo tra le due squadre ed eventuali conguagli.</GuideLine>
          <GuideLine title="Voto">Se la lega usa il mercato con voto, gli altri partecipanti possono approvare o rifiutare fino al quorum.</GuideLine>
          <GuideLine title="Zero backend">Il browser non trasferisce direttamente i giocatori: salva un comando append-only. La GitHub Action rilegge Team, budget, ruoli e stato mercato prima di applicarlo.</GuideLine>
        </GuideCard>

        <GuideCard icon={<Github size="$1.2" color="$color11" />} title="Repository e sicurezza">
          <GuideLine title="Fonte canonica">Ogni gruppo vive nel proprio repository Fantazone.*. Calendar, Rank, Team, TeamDay, mercato, Hall of Fame e asta usano JSON leggibili.</GuideLine>
          <GuideLine title="PAT condiviso">Nell’architettura attuale il token GitHub del gruppo è necessariamente disponibile al client e viene sincronizzato nelle impostazioni private OneDrive. Trattalo come una password del gruppo.</GuideLine>
          <GuideLine title="Inviti">Un link di invito che contiene la credenziale del gruppo va condiviso solo con la persona invitata.</GuideLine>
        </GuideCard>

        <GuideCard icon={<ShieldCheck size="$1.2" color="$red10" />} title="Ruoli amministrativi">
          <GuideLine title="Admin">Può gestire l’asta e le funzioni amministrative abilitate al gruppo.</GuideLine>
          <GuideLine title="SuperAdmin">Può gestire utenti, basket, leghe, impostazioni e ricalcoli. Le operazioni distruttive sono bloccate quando lascerebbero documenti canonici orfani.</GuideLine>
        </GuideCard>
      </XStack>

      <Surface accent="blue" padding="$4">
        <XStack gap="$3" alignItems="center" flexWrap="wrap">
          <ShieldCheck size="$1.2" color="$blue10" />
          <YStack flex={1} minWidth={240} gap="$1">
            <Text color="$color12" fontWeight="900">Principio guida</Text>
            <Paragraph color="$color9" size="$2">
              L’app lavora prima con i dati disponibili sul dispositivo e sincronizza con GitHub/OneDrive quando serve, senza introdurre un backend Fantazone centrale.
            </Paragraph>
          </YStack>
        </XStack>
      </Surface>
    </AppScreen>
  )
}

function GuideCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <YStack flexGrow={1} flexBasis={500} minWidth={280}>
      <Surface padding="$5">
        <YStack gap="$4">
          <XStack gap="$3" alignItems="center">
            <YStack width={44} height={44} borderRadius="$4" backgroundColor="$color3" alignItems="center" justifyContent="center">
              {icon}
            </YStack>
            <Text color="$color12" fontSize="$6" fontWeight="900">{title}</Text>
          </XStack>
          <YStack gap="$3">{children}</YStack>
        </YStack>
      </Surface>
    </YStack>
  )
}

function GuideLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <YStack gap="$1.5" paddingBottom="$3" borderBottomWidth={1} borderBottomColor="$color4">
      <Text color="$color12" fontWeight="900">{title}</Text>
      <Paragraph color="$color9" size="$2" lineHeight="$5">{children}</Paragraph>
    </YStack>
  )
}
