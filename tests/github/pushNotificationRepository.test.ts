import assert from 'node:assert/strict'
import test from 'node:test'
import { type PushNotificationSettings } from '../../src/domain/src/index'
import {
  FANTAZONE_VAPID_PUBLIC_KEY,
  GitHubJsonStore,
  GitHubPushNotificationRepository,
  GROUP_PUSH_SCRIPT,
  GROUP_PUSH_SCRIPT_PATH,
  GROUP_PUSH_WORKFLOW,
  GROUP_PUSH_WORKFLOW_PATH,
  pushNotificationSettingsPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  files = new Map<string, { sha: string; content: string }>()
  writes = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent(owner: string, repo: string, path: string, text: string, _message: string, _sha?: string, branch?: string) {
    const sha = `sha-${++this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Test', ref: 'main' }
const settings: PushNotificationSettings = {
  version: 1,
  email: 'ale@example.com',
  matchEvents: true,
  opponentMatchEvents: false,
  deploymentReminder: true,
  endDay: false,
  marketEvents: true,
  subscriptions: [{
    endpoint: 'https://push.example.test/subscription/1',
    p256dh: 'public-key',
    auth: 'auth-secret',
    createdAt: '2026-09-07T08:00:00.000Z',
  }],
}

test('push settings use a deterministic email-safe group path', () => {
  assert.equal(pushNotificationSettingsPath(' ALE@Example.com '), 'data/push/users/616c65406578616d706c652e636f6d.json')
})

test('push settings round-trip as readable group JSON', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubPushNotificationRepository(new GitHubJsonStore(client), target)
  await repository.write(settings)
  assert.deepEqual(await repository.get('ale@example.com', { refresh: true }), settings)
})

test('managed push transport references the Actions secret without embedding a private key', () => {
  assert.ok(FANTAZONE_VAPID_PUBLIC_KEY.length > 40)
  assert.equal(GROUP_PUSH_WORKFLOW_PATH, '.github/workflows/fantazone-push.yml')
  assert.equal(GROUP_PUSH_SCRIPT_PATH, '.github/fantazone/push-sender.mjs')
  assert.match(GROUP_PUSH_WORKFLOW, /secrets\.FANTAZONE_VAPID_PRIVATE_KEY/)
  assert.match(GROUP_PUSH_SCRIPT, /process\.env\.FANTAZONE_VAPID_PRIVATE_KEY/)
  assert.match(GROUP_PUSH_SCRIPT, /aes128gcm/)
  assert.doesNotMatch(GROUP_PUSH_WORKFLOW, /FANTAZONE_VAPID_PRIVATE_KEY:\s*['\"][A-Za-z0-9_-]{20,}/)
  assert.doesNotMatch(GROUP_PUSH_SCRIPT, /const\s+VAPID_PRIVATE_KEY\s*=\s*['\"]/)
})
