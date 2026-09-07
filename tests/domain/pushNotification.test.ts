import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addPushSubscription,
  emptyPushNotificationSettings,
  removePushSubscription,
  validatePushNotificationSettings,
} from '../../src/domain/src/index'

const subscription = {
  endpoint: 'https://push.example.test/subscription/1',
  p256dh: 'public-key',
  auth: 'auth-secret',
  createdAt: '2026-09-07T08:00:00.000Z',
}

test('push defaults preserve all legacy preference switches as disabled', () => {
  assert.deepEqual(emptyPushNotificationSettings(' ALE@Example.com '), {
    version: 1,
    email: 'ale@example.com',
    matchEvents: false,
    opponentMatchEvents: false,
    deploymentReminder: false,
    endDay: false,
    marketEvents: false,
    subscriptions: [],
  })
})

test('push subscriptions are endpoint-idempotent and removable', () => {
  const base = emptyPushNotificationSettings('ale@example.com')
  const once = addPushSubscription(base, subscription)
  const twice = addPushSubscription(once, { ...subscription, createdAt: '2026-09-07T09:00:00.000Z' })
  assert.equal(twice.subscriptions.length, 1)
  assert.equal(twice.subscriptions[0].createdAt, '2026-09-07T09:00:00.000Z')
  assert.equal(removePushSubscription(twice, subscription.endpoint).subscriptions.length, 0)
})

test('push settings reject duplicate endpoints and malformed subscriptions', () => {
  const valid = addPushSubscription(emptyPushNotificationSettings('ale@example.com'), subscription)
  assert.deepEqual(validatePushNotificationSettings(valid), valid)
  assert.throws(() => validatePushNotificationSettings({
    ...valid,
    subscriptions: [subscription, subscription],
  }), /Duplicate push subscription endpoint/)
  assert.throws(() => addPushSubscription(valid, { ...subscription, endpoint: 'http://unsafe.test' }), /HTTPS/)
})
