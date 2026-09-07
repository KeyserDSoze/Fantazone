export const FANTAZONE_VAPID_PUBLIC_KEY = 'BC-_PiSEDN7I_pQsMKcDZeIDSPG-_2cCVvseMFvug6SNCI0hI7lqR8viPNdCKig7ny2iSdOeGI7ioBup2vd4tJ8'
export const GROUP_PUSH_TRANSPORT_VERSION = 1
export const GROUP_PUSH_WORKFLOW_PATH = '.github/workflows/fantazone-push.yml'
export const GROUP_PUSH_SCRIPT_PATH = '.github/fantazone/push-sender.mjs'

export const GROUP_PUSH_WORKFLOW = [
  '# Managed by Fantazone. Local edits are replaced when Push transport is reinstalled.',
  `# fantazone-push-version: ${GROUP_PUSH_TRANSPORT_VERSION}`,
  'name: Fantazone push notifications',
  '',
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      email:',
  '        description: Recipient group email',
  '        required: true',
  '        type: string',
  '      title:',
  '        description: Notification title',
  '        required: true',
  '        type: string',
  '      body:',
  '        description: Notification body',
  '        required: true',
  '        type: string',
  '      url:',
  '        description: Destination URL',
  '        required: false',
  '        default: https://fanta.plus',
  '        type: string',
  '',
  'permissions:',
  '  contents: read',
  '',
  'concurrency:',
  '  group: fantazone-push-${{ github.repository }}-${{ inputs.email }}',
  '  cancel-in-progress: false',
  '',
  'jobs:',
  '  send:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v6',
  '      - uses: actions/setup-node@v6',
  '        with:',
  '          node-version: 22',
  '      - name: Send Web Push',
  '        env:',
  '          FANTAZONE_VAPID_PRIVATE_KEY: ${{ secrets.FANTAZONE_VAPID_PRIVATE_KEY }}',
  '        run: |',
  '          if [ -z "$FANTAZONE_VAPID_PRIVATE_KEY" ]; then',
  '            echo "Missing repository Actions secret FANTAZONE_VAPID_PRIVATE_KEY" >&2',
  '            exit 2',
  '          fi',
  `          node ${GROUP_PUSH_SCRIPT_PATH} "\${{ inputs.email }}" "\${{ inputs.title }}" "\${{ inputs.body }}" "\${{ inputs.url }}"`,
  '',
].join('\n')

export const GROUP_PUSH_SCRIPT = `// Managed by Fantazone. fantazone-push-version: ${GROUP_PUSH_TRANSPORT_VERSION}
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const VAPID_PUBLIC_KEY = '${FANTAZONE_VAPID_PUBLIC_KEY}'
const [emailArg, titleArg, bodyArg, urlArg] = process.argv.slice(2)
const email = normalizeEmail(emailArg)
if (!email || !titleArg || !bodyArg) throw new Error('email, title and body are required')
const privateKey = process.env.FANTAZONE_VAPID_PRIVATE_KEY?.trim()
if (!privateKey) throw new Error('FANTAZONE_VAPID_PRIVATE_KEY is required')

const path = 'data/push/users/' + hexUtf8(email) + '.json'
const settings = JSON.parse(await readFile(path, 'utf8'))
if (normalizeEmail(settings.email) !== email) throw new Error('Push settings email mismatch')
if (!Array.isArray(settings.subscriptions) || settings.subscriptions.length === 0) throw new Error('No Web Push subscriptions registered for ' + email)

const payload = {
  title: titleArg,
  body: bodyArg,
  data: { url: urlArg || 'https://fanta.plus' },
  icon: 'https://fanta.plus/icon-192.png',
  badge: 'https://fanta.plus/favicon.png',
}

let sent = 0
let expired = 0
for (const subscription of settings.subscriptions) {
  const result = await sendWebPush(subscription, payload, privateKey)
  if (result.ok) {
    sent += 1
    console.log('Push sent:', subscription.endpoint)
  } else if (result.status === 404 || result.status === 410) {
    expired += 1
    console.warn('Expired push subscription:', subscription.endpoint, 'HTTP', result.status)
  } else {
    console.error('Push failed:', subscription.endpoint, 'HTTP', result.status, result.text)
  }
}
console.log('Push result:', sent, 'sent,', expired, 'expired,', settings.subscriptions.length - sent - expired, 'failed')
if (sent === 0) process.exitCode = 1

async function sendWebPush(subscription, payloadValue, vapidPrivateKey) {
  const endpoint = new URL(subscription.endpoint)
  const clientPublicKey = fromBase64Url(subscription.p256dh)
  const authSecret = fromBase64Url(subscription.auth)
  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 4) throw new Error('Invalid p256dh public key')

  const server = createECDH('prime256v1')
  server.generateKeys()
  const serverPublicKey = server.getPublicKey()
  const sharedSecret = server.computeSecret(clientPublicKey)
  const authPrk = hmac(authSecret, sharedSecret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\\0'), clientPublicKey, serverPublicKey])
  const ikm = hkdfExpand(authPrk, keyInfo, 32)
  const salt = randomBytes(16)
  const prk = hmac(salt, ikm)
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\\0'), 16)
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\\0'), 12)

  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payloadValue), 'utf8'), Buffer.from([2])])
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  const body = Buffer.concat([salt, recordSize, Buffer.from([serverPublicKey.length]), serverPublicKey, encrypted])

  const jwt = createVapidJwt(endpoint.origin, VAPID_PUBLIC_KEY, vapidPrivateKey)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC_KEY,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '60',
      Urgency: 'normal',
    },
    body,
  })
  return { ok: response.ok, status: response.status, text: response.ok ? '' : await response.text() }
}

function createVapidJwt(audience, publicKey, privateKeyValue) {
  const publicBytes = fromBase64Url(publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('Invalid VAPID public key')
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'https://fanta.plus',
  })))
  const unsigned = header + '.' + claims
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(publicBytes.subarray(1, 33)),
      y: toBase64Url(publicBytes.subarray(33, 65)),
      d: privateKeyValue,
    },
    format: 'jwk',
  })
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  return unsigned + '.' + toBase64Url(signature)
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function hkdfExpand(prk, info, length) {
  const chunks = []
  let previous = Buffer.alloc(0)
  let counter = 1
  while (Buffer.concat(chunks).length < length) {
    previous = createHmac('sha256', prk).update(Buffer.concat([previous, info, Buffer.from([counter])])).digest()
    chunks.push(previous)
    counter += 1
  }
  return Buffer.concat(chunks).subarray(0, length)
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64')
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_')
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase() }
function hexUtf8(value) { return Buffer.from(value, 'utf8').toString('hex') }
`
