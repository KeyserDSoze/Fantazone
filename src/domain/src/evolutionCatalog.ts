import type {
  EvolutionCardDefinition,
  EvolutionConditionGroup,
  EvolutionEffect,
  EvolutionFootballEventType,
  EvolutionRole,
  EvolutionRuleDefinition,
  EvolutionRarity,
  EvolutionSkillDefinition,
} from './evolutionModel'

const stack = { mode: 'stack' as const }

function rule(
  id: string,
  name: string,
  description: string,
  conditions: EvolutionConditionGroup | undefined,
  effects: EvolutionEffect[],
  priority = 100,
): EvolutionRuleDefinition {
  return {
    id,
    name,
    description,
    source: 'player-skill',
    trigger: 'player-finalized',
    conditions,
    effects,
    priority,
    stacking: stack,
  }
}

function skill(
  id: string,
  name: string,
  description: string,
  role: EvolutionRole,
  power: number,
  rules: EvolutionRuleDefinition[],
  rarity: EvolutionRarity = power >= 80 ? 'legendary' : power >= 60 ? 'epic' : power >= 35 ? 'rare' : 'common',
  weight = 1,
): EvolutionSkillDefinition {
  return { id, name, description, roles: [role], rarity, power, weight, rules }
}

function condition(metric: Parameters<typeof conditionValue>[0], operator: Parameters<typeof conditionValue>[1], value: Parameters<typeof conditionValue>[2]) {
  return { all: [conditionValue(metric, operator, value)] }
}

function conditionValue(
  metric: EvolutionRuleDefinition['conditions'] extends never ? never : import('./evolutionModel').EvolutionMetric,
  operator: import('./evolutionModel').EvolutionOperator,
  value: number | string | boolean | Array<number | string | boolean>,
) {
  return { metric, operator, value } as const
}

function idNumber(value: number): string {
  return String(value).replace('-', 'm').replace('.', '_')
}

function goalkeeperSkills(): EvolutionSkillDefinition[] {
  const skills: EvolutionSkillDefinition[] = []

  for (const bonus of [1, 1.5, 2, 2.5, 3]) {
    const id = `gk-clean-sheet-${idNumber(bonus)}`
    skills.push(skill(
      id,
      `Saracinesca +${bonus}`,
      `Se non subisce gol ottiene +${bonus} punti extra.`,
      'goalkeeper',
      Math.round(24 + bonus * 12),
      [rule(`${id}-rule`, 'Clean sheet potenziato', 'Premia il portiere che non subisce gol.', condition('suffered-goals', 'eq', 0), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  for (const threshold of [2, 3, 4]) {
    for (const cancelled of [1, 2, 99]) {
      const label = cancelled === 99 ? 'tutti' : String(cancelled)
      const id = `gk-damage-control-${threshold}-${cancelled}`
      skills.push(skill(
        id,
        `Limitatore ${threshold}+`,
        `Se subisce almeno ${threshold} gol, annulla ${label} malus da gol subito.`,
        'goalkeeper',
        cancelled === 99 ? 82 : 38 + cancelled * 10,
        [rule(`${id}-rule`, 'Controllo danni', 'Neutralizza uno o più eventi gol subito.', condition('suffered-goals', 'gte', threshold), [{ type: 'cancel-event', target: 'self', eventType: 'suffered-goal', quantity: cancelled }])],
      ))
    }
  }

  for (const threshold of [6.5, 7, 7.5]) {
    const id = `gk-penalty-shield-${idNumber(threshold)}`
    skills.push(skill(
      id,
      `Guanti decisivi ${threshold}`,
      `Con voto puro almeno ${threshold}, annulla un gol su rigore avversario.`,
      'goalkeeper',
      threshold === 6.5 ? 78 : threshold === 7 ? 68 : 58,
      [rule(`${id}-rule`, 'Scudo rigori', 'Neutralizza un rigore segnato dall’avversario.', condition('raw-vote', 'gte', threshold), [{ type: 'cancel-event', target: 'opponent', eventType: 'penalty-goal', quantity: 1, selector: { strategy: 'highest-fantasy-value' } }])],
      threshold === 6.5 ? 'epic' : 'rare',
    ))
  }

  for (const bonus of [1, 2, 3]) {
    const id = `gk-penalty-save-${bonus}`
    skills.push(skill(
      id,
      `Specialista rigori +${bonus}`,
      `Ogni rigore parato attiva un bonus extra di +${bonus}.`,
      'goalkeeper',
      42 + bonus * 10,
      [rule(`${id}-rule`, 'Parata speciale', 'Premia il rigore parato.', condition('saved-penalties', 'gte', 1), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  for (const value of [5.5, 6]) {
    const id = `gk-virtual-vote-${idNumber(value)}`
    skills.push(skill(
      id,
      `Presenza garantita ${value}`,
      `Se non prende voto, il suo punteggio personale vale almeno ${value}.`,
      'goalkeeper',
      value === 6 ? 88 : 70,
      [rule(`${id}-rule`, 'Voto virtuale', 'Garantisce un minimo anche senza voto.', condition('has-vote', 'eq', false), [{ type: 'set-player-score', target: 'self', value, mode: 'at-least' }])],
      value === 6 ? 'legendary' : 'epic',
    ))
  }

  return skills
}

function defenderSkills(): EvolutionSkillDefinition[] {
  const skills: EvolutionSkillDefinition[] = []

  for (const bonus of [1, 1.5, 2, 2.5]) {
    const id = `df-red-card-rebel-${idNumber(bonus)}`
    skills.push(skill(
      id,
      `Ribelle +${bonus}`,
      `Se viene espulso ottiene +${bonus} punti extra.`,
      'defender',
      28 + Math.round(bonus * 10),
      [rule(`${id}-rule`, 'Espulsione ribaltata', 'Trasforma l’espulsione in un rischio calcolato.', condition('red-card', 'eq', true), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  for (const threshold of [6.5, 7, 7.5]) {
    for (const eventType of ['assist', 'goal'] as EvolutionFootballEventType[]) {
      const id = `df-wall-${eventType}-${idNumber(threshold)}`
      skills.push(skill(
        id,
        eventType === 'goal' ? `Muro ${threshold}` : `Interdizione ${threshold}`,
        `Con voto puro almeno ${threshold}, annulla un ${eventType === 'goal' ? 'gol' : 'assist'} avversario.`,
        'defender',
        eventType === 'goal' ? 72 : 52,
        [rule(`${id}-rule`, 'Intervento difensivo', 'Neutralizza un evento offensivo avversario.', condition('raw-vote', 'gte', threshold), [{ type: 'cancel-event', target: 'opponent', eventType, quantity: 1, selector: { strategy: 'highest-fantasy-value' } }])],
        eventType === 'goal' ? 'epic' : 'rare',
      ))
    }
  }

  for (const slot of [1, 2, 3, 4, 5]) {
    for (const bonus of [0.5, 1]) {
      const id = `df-slot-${slot}-${idNumber(bonus)}`
      skills.push(skill(
        id,
        `Specialista ${slot}° difensore`,
        `Se è schierato come ${slot}° difensore ottiene +${bonus}.`,
        'defender',
        24 + slot * 2 + Math.round(bonus * 12),
        [rule(`${id}-rule`, 'Posizione naturale', 'Premia lo slot esatto nel reparto.', condition('role-slot', 'eq', slot), [{ type: 'add-score', target: 'self', value: bonus }])],
      ))
    }
  }

  for (const bonus of [2, 3]) {
    const id = `df-own-goal-redemption-${bonus}`
    skills.push(skill(
      id,
      `Redenzione autogol +${bonus}`,
      `Se fa autogol reagisce con +${bonus} punti extra.`,
      'defender',
      40 + bonus * 7,
      [rule(`${id}-rule`, 'Reazione all’autogol', 'Compensa parzialmente un autogol.', condition('own-goals', 'gte', 1), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  return skills
}

function midfielderSkills(): EvolutionSkillDefinition[] {
  const skills: EvolutionSkillDefinition[] = []

  for (const value of [5.5, 6, 6.5]) {
    const id = `mf-virtual-vote-${idNumber(value)}`
    skills.push(skill(
      id,
      `Sempre nel vivo ${value}`,
      `Se non entra, il suo punteggio personale vale almeno ${value}.`,
      'midfielder',
      value >= 6.5 ? 96 : value >= 6 ? 86 : 66,
      [rule(`${id}-rule`, 'Presenza virtuale', 'Garantisce un punteggio anche senza voto.', condition('has-vote', 'eq', false), [{ type: 'set-player-score', target: 'self', value, mode: 'at-least' }])],
      value >= 6.5 ? 'legendary' : value >= 6 ? 'legendary' : 'epic',
    ))
  }

  for (const bonus of [0.5, 1, 1.5]) {
    const id = `mf-assist-leader-${idNumber(bonus)}`
    skills.push(skill(
      id,
      `Regista +${bonus}`,
      `Se fa almeno un assist, la squadra ottiene +${bonus}.`,
      'midfielder',
      34 + Math.round(bonus * 14),
      [rule(`${id}-rule`, 'Leadership', 'Trasforma l’assist in un bonus di squadra.', condition('assists', 'gte', 1), [{ type: 'add-score', target: 'team', value: bonus }])],
    ))
  }

  for (const eventType of ['yellow-card', 'red-card'] as EvolutionFootballEventType[]) {
    const id = `mf-goal-cleans-${eventType}`
    skills.push(skill(
      id,
      eventType === 'yellow-card' ? 'Gol che cancella il giallo' : 'Gol che cancella il rosso',
      `Se segna, annulla un ${eventType === 'yellow-card' ? 'giallo' : 'rosso'} di un compagno.`,
      'midfielder',
      eventType === 'red-card' ? 62 : 44,
      [rule(`${id}-rule`, 'Scossa positiva', 'Il gol neutralizza una sanzione disciplinare.', condition('goals', 'gte', 1), [{ type: 'cancel-event', target: 'team', eventType, quantity: 1, selector: { strategy: 'lowest-fantasy-value' } }])],
    ))
  }

  for (const threshold of [6.5, 7]) {
    for (const bonus of [1, 1.5]) {
      const id = `mf-quality-${idNumber(threshold)}-${idNumber(bonus)}`
      skills.push(skill(
        id,
        `Qualità ${threshold} +${bonus}`,
        `Con voto puro almeno ${threshold} ottiene +${bonus}.`,
        'midfielder',
        32 + Math.round(bonus * 10) + (threshold === 6.5 ? 8 : 0),
        [rule(`${id}-rule`, 'Qualità premiata', 'Premia una prestazione di qualità.', condition('raw-vote', 'gte', threshold), [{ type: 'add-score', target: 'self', value: bonus }])],
      ))
    }
  }

  for (const slot of [1, 2, 3, 4, 5]) {
    for (const bonus of [0.5, 1]) {
      const id = `mf-slot-${slot}-${idNumber(bonus)}`
      skills.push(skill(
        id,
        `Interno ${slot} +${bonus}`,
        `Se occupa lo slot ${slot} del centrocampo ottiene +${bonus}.`,
        'midfielder',
        22 + slot * 2 + Math.round(bonus * 10),
        [rule(`${id}-rule`, 'Slot ideale', 'Premia il posizionamento esatto nel reparto.', condition('role-slot', 'eq', slot), [{ type: 'add-score', target: 'self', value: bonus }])],
      ))
    }
  }

  return skills
}

function forwardSkills(): EvolutionSkillDefinition[] {
  const skills: EvolutionSkillDefinition[] = []

  for (const eventType of ['yellow-card', 'red-card'] as EvolutionFootballEventType[]) {
    const id = `fw-brace-cleans-${eventType}`
    skills.push(skill(
      id,
      eventType === 'yellow-card' ? 'Doppietta purificatrice' : 'Doppietta totale',
      `Con una doppietta annulla un ${eventType === 'yellow-card' ? 'giallo' : 'rosso'} di un compagno.`,
      'forward',
      eventType === 'red-card' ? 72 : 56,
      [rule(`${id}-rule`, 'Doppietta decisiva', 'Una doppietta cancella una sanzione disciplinare.', condition('goals', 'gte', 2), [{ type: 'cancel-event', target: 'team', eventType, quantity: 1, selector: { strategy: 'lowest-fantasy-value' } }])],
      eventType === 'red-card' ? 'epic' : 'rare',
    ))
  }

  for (const bonus of [0.5, 1, 1.5, 2]) {
    const id = `fw-goal-instinct-${idNumber(bonus)}`
    skills.push(skill(
      id,
      `Istinto del gol +${bonus}`,
      `Se segna almeno un gol ottiene +${bonus} extra.`,
      'forward',
      36 + Math.round(bonus * 14),
      [rule(`${id}-rule`, 'Istinto del gol', 'Premia il gol con un extra.', condition('goals', 'gte', 1), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  for (const bonus of [0.5, 1, 1.5]) {
    const id = `fw-penalty-specialist-${idNumber(bonus)}`
    skills.push(skill(
      id,
      `Cecchino +${bonus}`,
      `Se segna su rigore ottiene +${bonus} extra.`,
      'forward',
      28 + Math.round(bonus * 12),
      [rule(`${id}-rule`, 'Rigore speciale', 'Premia il gol dal dischetto.', condition('penalty-goals', 'gte', 1), [{ type: 'add-score', target: 'self', value: bonus }])],
    ))
  }

  for (const threshold of [7, 7.5]) {
    for (const eventType of ['assist', 'goal'] as EvolutionFootballEventType[]) {
      const id = `fw-pressure-${eventType}-${idNumber(threshold)}`
      skills.push(skill(
        id,
        `Pressione offensiva ${threshold}`,
        `Con voto puro almeno ${threshold}, annulla un ${eventType === 'goal' ? 'gol' : 'assist'} avversario.`,
        'forward',
        eventType === 'goal' ? 76 : 54,
        [rule(`${id}-rule`, 'Pressione offensiva', 'La grande prestazione riduce l’impatto avversario.', condition('raw-vote', 'gte', threshold), [{ type: 'cancel-event', target: 'opponent', eventType, quantity: 1, selector: { strategy: 'highest-fantasy-value' } }])],
        eventType === 'goal' ? 'epic' : 'rare',
      ))
    }
  }

  for (const slot of [1, 2, 3]) {
    for (const bonus of [0.5, 1]) {
      const id = `fw-slot-${slot}-${idNumber(bonus)}`
      skills.push(skill(
        id,
        `Attaccante ${slot} +${bonus}`,
        `Se occupa lo slot ${slot} dell’attacco ottiene +${bonus}.`,
        'forward',
        24 + slot * 3 + Math.round(bonus * 10),
        [rule(`${id}-rule`, 'Posizione d’attacco', 'Premia lo slot esatto nel tridente o nella coppia.', condition('role-slot', 'eq', slot), [{ type: 'add-score', target: 'self', value: bonus }])],
      ))
    }
  }

  for (const bonus of [2, 3]) {
    const id = `fw-hat-trick-team-${bonus}`
    skills.push(skill(
      id,
      `Trascinatore tripletta +${bonus}`,
      `Con almeno tre gol la squadra ottiene +${bonus}.`,
      'forward',
      56 + bonus * 6,
      [rule(`${id}-rule`, 'Tripletta trascinante', 'La tripletta produce anche un bonus collettivo.', condition('goals', 'gte', 3), [{ type: 'add-score', target: 'team', value: bonus }])],
      'rare',
    ))
  }

  return skills
}

export function getBuiltinEvolutionSkills(version = 1): EvolutionSkillDefinition[] {
  if (version !== 1) throw new Error(`Unsupported Fantazone Evolution skill catalog version ${version}`)
  return [...goalkeeperSkills(), ...defenderSkills(), ...midfielderSkills(), ...forwardSkills()]
}

function cardRule(
  id: string,
  name: string,
  description: string,
  conditions: EvolutionConditionGroup | undefined,
  effects: EvolutionEffect[],
  priority = 200,
): EvolutionRuleDefinition {
  return {
    id,
    name,
    description,
    source: 'coach-card',
    trigger: 'team-finalized',
    conditions,
    effects,
    priority,
    stacking: stack,
  }
}

const defenderBelowSixSelector = {
  roles: ['defender'] as EvolutionRole[],
  where: { all: [{ metric: 'raw-vote' as const, operator: 'lt' as const, value: 6 }] },
  strategy: 'lowest-raw-vote' as const,
  quantity: 1,
}

const BUILTIN_CARDS: EvolutionCardDefinition[] = [
  {
    id: 'card-433-aggressive-pressing',
    name: '4-3-3 Aggressivo · Pressing',
    description: 'Se almeno due difensori avversari prendono meno di 6, assegna un autogol a uno di loro.',
    flavorText: 'Pressione alta sulle uscite: il reparto avversario può andare in errore.',
    category: 'formation', rarity: 'epic', power: 78, weight: 1,
    rules: [cardRule(
      'card-433-aggressive-pressing-rule',
      'Errore forzato',
      'Due difensori sotto 6 producono un autogol virtuale.',
      { all: [{ subject: 'opponent', metric: 'matching-player-count', operator: 'gte', value: 2, selector: defenderBelowSixSelector }] },
      [{ type: 'add-event', target: 'opponent', eventType: 'own-goal', quantity: 1, selector: defenderBelowSixSelector }],
    )],
  },
  {
    id: 'card-counter-433',
    name: 'Gabbia sul 4-3-3',
    description: 'Se l’avversario gioca 4-3-3 parte con 4 fantapunti in meno.',
    flavorText: 'Densità centrale e uscite mirate sugli esterni.',
    category: 'counter', rarity: 'rare', power: 68, weight: 1,
    rules: [cardRule('card-counter-433-rule', 'Contromisura 4-3-3', 'Penalizza il 4-3-3 avversario.', { all: [{ subject: 'opponent', metric: 'team-formation', operator: 'eq', value: '4-3-3' }] }, [{ type: 'add-score', target: 'opponent', value: -4 }])],
  },
  {
    id: 'card-counter-352',
    name: 'Ampiezza contro 3-5-2',
    description: 'Se l’avversario gioca 3-5-2, annulla il suo primo assist.',
    flavorText: 'Allarga il blocco e sporca il servizio delle mezzali.',
    category: 'counter', rarity: 'rare', power: 56, weight: 1,
    rules: [cardRule('card-counter-352-rule', 'Corsie chiuse', 'Annulla un assist contro il 3-5-2.', { all: [{ subject: 'opponent', metric: 'team-formation', operator: 'eq', value: '3-5-2' }] }, [{ type: 'cancel-event', target: 'opponent', eventType: 'assist', quantity: 1, selector: { strategy: 'highest-fantasy-value' } }])],
  },
  {
    id: 'card-team-full-house',
    name: 'Undici Uniti',
    description: 'Se tutti gli undici titolari prendono voto, la squadra ottiene +1.',
    flavorText: 'Nessuno resta fuori dalla partita.',
    category: 'team', rarity: 'common', power: 30, weight: 2,
    rules: [cardRule('card-team-full-house-rule', 'Tutti presenti', 'Premia l’undici completamente attivo.', { all: [{ subject: 'team', metric: 'starters-played-count', operator: 'gte', value: 11 }] }, [{ type: 'add-score', target: 'team', value: 1 }])],
  },
  {
    id: 'card-high-press',
    name: 'Pressing Alto',
    description: 'Se almeno tre avversari prendono un cartellino giallo, ottieni +2.',
    flavorText: 'La pressione costringe l’avversario a fermarti fallosamente.',
    category: 'tactic', rarity: 'rare', power: 48, weight: 1,
    rules: [cardRule('card-high-press-rule', 'Falli forzati', 'Tre gialli avversari attivano il bonus.', { all: [{ subject: 'opponent', metric: 'matching-player-count', operator: 'gte', value: 3, selector: { where: { all: [{ metric: 'yellow-card', operator: 'eq', value: true }] } } }] }, [{ type: 'add-score', target: 'team', value: 2 }])],
  },
  {
    id: 'card-offside-trap',
    name: 'Trappola del Fuorigioco',
    description: 'Annulla un gol segnato da un attaccante avversario.',
    flavorText: 'Linea alta e sincronizzata: una rete viene resa inefficace.',
    category: 'tactic', rarity: 'epic', power: 76, weight: 0.8,
    rules: [cardRule('card-offside-trap-rule', 'Gol neutralizzato', 'Annulla una rete di un attaccante.', undefined, [{ type: 'cancel-event', target: 'opponent', eventType: 'goal', quantity: 1, selector: { roles: ['forward'], strategy: 'highest-fantasy-value' } }])],
  },
  {
    id: 'card-low-block',
    name: 'Blocco Basso',
    description: 'Se nessun attaccante avversario segna, ottieni +3.',
    flavorText: 'Area protetta e spazi centrali chiusi.',
    category: 'tactic', rarity: 'rare', power: 52, weight: 1,
    rules: [cardRule('card-low-block-rule', 'Area blindata', 'Premia la capacità di non concedere gol agli attaccanti.', { all: [{ subject: 'opponent', metric: 'matching-player-count', operator: 'eq', value: 0, selector: { roles: ['forward'], where: { all: [{ metric: 'goals', operator: 'gte', value: 1 }] } } }] }, [{ type: 'add-score', target: 'team', value: 3 }])],
  },
  {
    id: 'card-double-own-goal',
    name: 'Pressione Psicologica',
    description: 'Il primo autogol avversario vale doppio.',
    flavorText: 'Ogni errore nella propria area viene amplificato.',
    category: 'wildcard', rarity: 'rare', power: 44, weight: 1,
    rules: [cardRule('card-double-own-goal-rule', 'Autogol raddoppiato', 'Raddoppia il valore del primo autogol avversario.', undefined, [{ type: 'multiply-event', target: 'opponent', eventType: 'own-goal', factor: 2, quantity: 1, selector: { strategy: 'lowest-fantasy-value' } }])],
  },
  {
    id: 'card-midfield-control',
    name: 'Controllo del Centrocampo',
    description: 'Se almeno tre centrocampisti prendono 6.5 o più, ottieni +2.',
    flavorText: 'Il possesso passa stabilmente dalla tua parte.',
    category: 'tactic', rarity: 'common', power: 38, weight: 1.5,
    rules: [cardRule('card-midfield-control-rule', 'Dominio centrale', 'Tre centrocampisti sopra 6.5 attivano il bonus.', { all: [{ subject: 'team', metric: 'matching-player-count', operator: 'gte', value: 3, selector: { roles: ['midfielder'], where: { all: [{ metric: 'raw-vote', operator: 'gte', value: 6.5 }] } } }] }, [{ type: 'add-score', target: 'team', value: 2 }])],
  },
  {
    id: 'card-defensive-shell',
    name: 'Linea di Ferro',
    description: 'Se almeno tre difensori prendono 6 o più, ottieni +1.5.',
    flavorText: 'Il reparto resta corto e compatto.',
    category: 'team', rarity: 'common', power: 34, weight: 1.5,
    rules: [cardRule('card-defensive-shell-rule', 'Reparto solido', 'Tre difensori sufficienti attivano il bonus.', { all: [{ subject: 'team', metric: 'matching-player-count', operator: 'gte', value: 3, selector: { roles: ['defender'], where: { all: [{ metric: 'raw-vote', operator: 'gte', value: 6 }] } } }] }, [{ type: 'add-score', target: 'team', value: 1.5 }])],
  },
  {
    id: 'card-penalty-shield',
    name: 'Studio dal Dischetto',
    description: 'Annulla un gol su rigore dell’avversario.',
    flavorText: 'Il portiere conosce la rincorsa e sceglie il lato giusto.',
    category: 'wildcard', rarity: 'legendary', power: 86, weight: 0.4,
    rules: [cardRule('card-penalty-shield-rule', 'Rigore neutralizzato', 'Neutralizza un rigore avversario.', undefined, [{ type: 'cancel-event', target: 'opponent', eventType: 'penalty-goal', quantity: 1, selector: { strategy: 'highest-fantasy-value' } }])],
  },
  {
    id: 'card-comeback',
    name: 'Scossa dalla Panchina',
    description: 'Se almeno un subentrato prende voto, ottieni +1.',
    flavorText: 'La partita cambia con le mosse dell’allenatore.',
    category: 'team', rarity: 'common', power: 22, weight: 2,
    rules: [cardRule('card-comeback-rule', 'Impatto dei cambi', 'Premia un subentrato realmente utilizzato.', { all: [{ subject: 'team', metric: 'matching-player-count', operator: 'gte', value: 1, selector: { fantasyPositions: [4, 5, 6, 7, 8, 9, 10], where: { all: [{ metric: 'has-vote', operator: 'eq', value: true }] } } }] }, [{ type: 'add-score', target: 'team', value: 1 }])],
  },
]

export function getBuiltinEvolutionCards(version = 1): EvolutionCardDefinition[] {
  if (version !== 1) throw new Error(`Unsupported Fantazone Evolution card catalog version ${version}`)
  return BUILTIN_CARDS.map(card => JSON.parse(JSON.stringify(card)) as EvolutionCardDefinition)
}
