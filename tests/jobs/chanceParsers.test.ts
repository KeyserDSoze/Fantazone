import assert from 'node:assert/strict'
import test from 'node:test'
import { ChanceType } from '../../src/domain/src/index'
import {
  parseFantacalcioInjuries,
  parseFantagazzettaProbableLineups,
  parseGazzettaProbableLineups,
} from '../../src/jobs/src/chanceParsers'

test('Fantagazzetta parser extracts starting players and team slugs', () => {
  const html = `
    <ul class="player-list starters">
      <li class="player-item"><a href="https://www.fantacalcio.it/serie-a/squadre/roma/rosa"><span>Mario Rossi</span></a></li>
    </ul>
    <ul class="player-list starters">
      <li class="player-item"><a href="https://www.fantacalcio.it/serie-a/squadre/milan/rosa"><span>Luca Bianchi</span></a></li>
    </ul>`

  const players = parseFantagazzettaProbableLineups(html)
  assert.equal(players.length, 2)
  assert.equal(players[0].name, 'Mario Rossi')
  assert.equal(players[0].team.name, 'Roma')
  assert.equal(players[0].chance.fantagazzetta, true)
  assert.equal(players[1].team.name, 'Milan')
})

test('Fantagazzetta skips malformed player without team link', () => {
  const html = '<ul class="player-list starters"><li class="player-item"><span>Malformed Player</span></li></ul>'
  assert.deepEqual(parseFantagazzettaProbableLineups(html), [])
})

test('Gazzetta parser extracts both lineups', () => {
  const html = `
    <div class="bck-box-match-details">
      <a href="https://www.gazzetta.it/calcio/squadre/roma/">Roma</a>
      <a href="https://www.gazzetta.it/calcio/squadre/milan/">Milan</a>
      <ul><li><span class="lineup-team__name">Mario Rossi</span></li></ul>
      <ul><li><span class="lineup-team__name">Luca Bianchi</span></li></ul>
      <div class="go-above-container"></div>
    </div>`

  const players = parseGazzettaProbableLineups(html)
  assert.equal(players.length, 2)
  assert.equal(players[0].name, 'mario rossi')
  assert.equal(players[0].team.name, 'Roma')
  assert.equal(players[0].chance.gazzetta, true)
  assert.equal(players[1].team.name, 'Milan')
})

test('Gazzetta skips incomplete markup', () => {
  assert.deepEqual(parseGazzettaProbableLineups('<div class="bck-box-match-details"><ul></ul></div>'), [])
})

test('Injury parser preserves legacy header-index status mapping and descriptions', () => {
  const html = `
    <div id="team-roma">
      <span class="team-name">Roma</span>
      <header><strong class="item-name">Paulo Dybala</strong><p>Lesione muscolare</p></header>
      <header><strong class="item-name">Lorenzo Pellegrini</strong><p class="item-description">In dubbio</p></header>
    </div>`

  const players = parseFantacalcioInjuries(html)
  assert.equal(players.length, 2)
  assert.equal(players[0].name, 'paulo dybala')
  assert.equal(players[0].team.name, 'Roma')
  assert.equal(players[0].chance.status, ChanceType.Injury)
  assert.equal(players[0].chance.description, 'Lesione muscolare')
  assert.equal(players[1].chance.status, ChanceType.Warned)
  assert.equal(players[1].chance.description, 'In dubbio')
})

test('all migrated parsers return empty for empty input', () => {
  assert.deepEqual(parseFantagazzettaProbableLineups(''), [])
  assert.deepEqual(parseGazzettaProbableLineups(''), [])
  assert.deepEqual(parseFantacalcioInjuries(''), [])
})
