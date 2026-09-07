import assert from 'node:assert/strict'
import test from 'node:test'
import { LeagueType, type Group } from '../../src/domain/src/index'
import {
  GROUP_SETTINGS_PATH,
  GitHubGroupSettingsRepository,
  GitHubJsonStore,
  applyGroupRepositorySettings,
  createGroupRepositorySettings,
  decodeGroupRepositorySettings,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, _sha?: string, branch?: string) {
    this.writes += 1
    const sha = `write-${this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'qualsiasi-nome', ref: 'main' }
const group: Group = {
  id: 'stable-group-id',
  name: 'Nome legacy',
  users: [],
  baskets: [],
  leagues: [
    { id: 'serie-a', name: 'Serie A legacy', isMain: true, type: LeagueType.League, years: [], basketsId: [] },
    { id: 'coppa', name: 'Coppa legacy', isMain: false, type: LeagueType.Cup, years: [], basketsId: [] },
  ],
}

test('creates root settings keyed by stable league ids, independent from repository name', () => {
  assert.deepEqual(createGroupRepositorySettings(group), {
    version: 1,
    group: { name: 'Nome legacy' },
    leagues: {
      'serie-a': { name: 'Serie A legacy' },
      coppa: { name: 'Coppa legacy' },
    },
  })
})

test('display settings rename group and leagues without changing ids or canonical structure', () => {
  const settings = decodeGroupRepositorySettings({
    version: 1,
    group: { name: 'Fantacalcio del Bar' },
    leagues: {
      'serie-a': { name: 'Campionato' },
      coppa: { name: 'Coppa del Nonno' },
    },
  })
  const displayed = applyGroupRepositorySettings(group, settings)

  assert.equal(displayed.id, group.id)
  assert.equal(displayed.name, 'Fantacalcio del Bar')
  assert.deepEqual(displayed.leagues.map(league => league.id), ['serie-a', 'coppa'])
  assert.deepEqual(displayed.leagues.map(league => league.name), ['Campionato', 'Coppa del Nonno'])
  assert.equal(group.name, 'Nome legacy')
  assert.equal(group.leagues[0].name, 'Serie A legacy')
})

test('repository roundtrip persists readable settings.json at the repository root', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubGroupSettingsRepository(new GitHubJsonStore(client), target)
  const settings = createGroupRepositorySettings(group)
  settings.group.name = 'Nome nuovo'
  settings.leagues['serie-a'].name = 'Lega Principale'

  await repository.writeSettings(settings, 'test: settings', { createOnly: true })
  const raw = client.files.get(`${target.owner}/${target.repo}/${GROUP_SETTINGS_PATH}@main`)
  assert.ok(raw)
  assert.equal(JSON.parse(raw.content).group.name, 'Nome nuovo')
  assert.equal((await repository.getSettings({ refresh: true }))?.leagues['serie-a'].name, 'Lega Principale')
})

test('rejects malformed or empty display names', () => {
  assert.throws(() => decodeGroupRepositorySettings({ version: 1, group: { name: '' }, leagues: {} }), /Group name/)
  assert.throws(() => decodeGroupRepositorySettings({ version: 1, group: { name: 'Ok' }, leagues: { x: { name: '' } } }), /League x name/)
  assert.throws(() => decodeGroupRepositorySettings({ version: 2, group: { name: 'Ok' }, leagues: {} }), /Unsupported/)
})
