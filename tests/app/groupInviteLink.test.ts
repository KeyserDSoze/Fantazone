import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment } from '../../src/github/src/invite'
import {
  isValidInviteUnlockCode,
  normalizeInviteUnlockCode,
  parseInviteLinkFragment,
} from '../../src/app/services/groupInviteLink'

const validCode = '2345-6789-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'

test('accepts the full 160-bit grouped unlock code and normalizes separators', () => {
  assert.equal(isValidInviteUnlockCode(validCode), true)
  assert.equal(
    normalizeInviteUnlockCode(' 2345 6789 abcd efgh jklm npqr stuv wxyz '),
    '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  )
})

test('rejects short numeric OTPs and ambiguous alphabet characters', () => {
  assert.equal(isValidInviteUnlockCode('123456'), false)
  assert.equal(isValidInviteUnlockCode('2345-6789-ABCD-EFGH-IJKL-NPQR-STUV-WXYZ'), false)
})

test('parses only the current encrypted invitation fragment without loading native crypto', () => {
  const invite = {
    group: 'Amici',
    repository: 'owner/repository',
    email: 'Invite@Example.com',
    sealed: 'ciphertext-base64',
  }
  const fragment = createInviteFragment(invite)
  assert.deepEqual(parseInviteLinkFragment(fragment), {
    ...invite,
    email: 'invite@example.com',
  })
  assert.equal(parseInviteLinkFragment('#join=obsolete'), null)
})
