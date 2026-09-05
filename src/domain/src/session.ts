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

/**
 * Resolve a verified external identity against the already-selected group.
 * The PAT/repository selection must happen before calling this function.
 */
export function resolveGroupLogin(group: Group, identity: ExternalIdentity): GroupLoginResolution {
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
): AuthenticatedGroupSession | null {
  const resolution = resolveGroupLogin(group, identity)
  return resolution.status === 'authorized'
    ? { group, identity, member: resolution.member }
    : null
}
