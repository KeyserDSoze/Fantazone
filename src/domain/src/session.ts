import { GroupHelper, IdentityRole, type Group, type UserOfAGroup } from './group'

export type ExternalIdentityProvider = 'google' | 'microsoft'

/** Identity proven by an external OIDC provider. It does not contain Fantazone roles. */
export interface ExternalIdentity {
  provider: ExternalIdentityProvider
  subject: string
  email: string
  displayName?: string
}

export type GroupLoginResolution =
  | { status: 'authorized'; identity: ExternalIdentity; member: UserOfAGroup }
  | { status: 'not-member'; identity: ExternalIdentity }
  | { status: 'disabled'; identity: ExternalIdentity; member: UserOfAGroup }
  | { status: 'invite-email-mismatch'; identity: ExternalIdentity; expectedEmail: string }

/**
 * Resolve a verified external identity against the already-selected group.
 * The PAT/repository selection must happen before calling this function.
 */
export function resolveGroupLogin(
  group: Group,
  identity: ExternalIdentity,
  expectedEmail?: string,
): GroupLoginResolution {
  const expected = normalizeEmail(expectedEmail)
  if (expected && normalizeEmail(identity.email) !== expected) {
    return { status: 'invite-email-mismatch', identity, expectedEmail: expected }
  }
  const member = GroupHelper.findUserByEmail(group, identity.email)
  if (!member) return { status: 'not-member', identity }
  if (member.role === IdentityRole.None) return { status: 'disabled', identity, member }
  return { status: 'authorized', identity, member }
}

export interface AuthenticatedGroupSession {
  group: Group
  identity: ExternalIdentity
  member: UserOfAGroup
}

export function createAuthenticatedGroupSession(
  group: Group,
  identity: ExternalIdentity,
  expectedEmail?: string,
): AuthenticatedGroupSession | null {
  const resolution = resolveGroupLogin(group, identity, expectedEmail)
  return resolution.status === 'authorized'
    ? { group, identity, member: resolution.member }
    : null
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}
