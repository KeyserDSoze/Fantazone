import {
  GroupHelper,
  IdentityRole,
  type Group,
  type UserOfAGroup,
} from '@fantazone/domain'

export type GroupUserAdminRuntime = {
  refreshGroup(): Promise<Group>
  groupRepository: {
    writeGroup(group: Group, message?: string): Promise<string>
  }
}

export async function setGroupMemberRole(
  runtime: GroupUserAdminRuntime,
  actor: UserOfAGroup,
  email: string,
  role: IdentityRole,
): Promise<Group> {
  assertKnownRoleFlags(role)
  const group = await runtime.refreshGroup()
  const currentActor = requireSuperAdmin(group, actor.email)
  const target = requireMember(group, email)
  const normalizedTarget = normalizeEmail(target.email)

  if (normalizedTarget === normalizeEmail(currentActor.email) && role === IdentityRole.None) {
    throw new Error('Non puoi disabilitare il tuo stesso accesso mentre stai amministrando il gruppo.')
  }
  ensureSuperAdminSurvives(group, target, role)

  const updated: Group = {
    ...group,
    users: group.users.map(user => normalizeEmail(user.email) === normalizedTarget ? { ...user, role } : user),
  }
  await runtime.groupRepository.writeGroup(updated, `chore: update role ${target.email}`)
  return runtime.refreshGroup()
}

export async function toggleGroupMemberRole(
  runtime: GroupUserAdminRuntime,
  actor: UserOfAGroup,
  email: string,
  flag: IdentityRole.Reader | IdentityRole.Participant | IdentityRole.Admin | IdentityRole.SuperAdmin,
): Promise<Group> {
  const group = await runtime.refreshGroup()
  const target = requireMember(group, email)
  const next = GroupHelper.hasRole(target, flag) ? target.role & ~flag : target.role | flag
  return setGroupMemberRole(runtime, actor, email, next as IdentityRole)
}

export async function disableGroupMember(
  runtime: GroupUserAdminRuntime,
  actor: UserOfAGroup,
  email: string,
): Promise<Group> {
  return setGroupMemberRole(runtime, actor, email, IdentityRole.None)
}

export async function renameGroupMember(
  runtime: GroupUserAdminRuntime,
  actor: UserOfAGroup,
  email: string,
  username: string,
): Promise<Group> {
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const target = requireMember(group, email)
  const normalizedUsername = username.trim()
  if (!normalizedUsername) throw new Error('Il nome utente non può essere vuoto.')
  const targetEmail = normalizeEmail(target.email)
  const updated: Group = {
    ...group,
    users: group.users.map(user => normalizeEmail(user.email) === targetEmail ? { ...user, username: normalizedUsername } : user),
  }
  await runtime.groupRepository.writeGroup(updated, `chore: rename member ${target.email}`)
  return runtime.refreshGroup()
}

function requireSuperAdmin(group: Group, email: string): UserOfAGroup {
  const actor = GroupHelper.findUserByEmail(group, email)
  if (!actor || !GroupHelper.hasRole(actor, IdentityRole.SuperAdmin)) {
    throw new Error('Solo un SuperAdmin può modificare utenti e ruoli del gruppo.')
  }
  return actor
}

function requireMember(group: Group, email: string): UserOfAGroup {
  const member = GroupHelper.findUserByEmail(group, email)
  if (!member) throw new Error(`L’utente ${email} non è presente nel gruppo.`)
  return member
}

function ensureSuperAdminSurvives(group: Group, target: UserOfAGroup, nextRole: IdentityRole): void {
  if (!GroupHelper.hasRole(target, IdentityRole.SuperAdmin)) return
  if ((nextRole & IdentityRole.SuperAdmin) === IdentityRole.SuperAdmin) return
  const otherSuperAdmins = group.users.filter(user =>
    normalizeEmail(user.email) !== normalizeEmail(target.email) &&
    GroupHelper.hasRole(user, IdentityRole.SuperAdmin),
  )
  if (otherSuperAdmins.length === 0) {
    throw new Error('Il gruppo deve mantenere almeno un SuperAdmin attivo.')
  }
}

function assertKnownRoleFlags(role: IdentityRole): void {
  if (!Number.isInteger(role) || role < 0) throw new Error('Ruolo non valido.')
  const allFlags = IdentityRole.Reader | IdentityRole.Participant | IdentityRole.Admin | IdentityRole.SuperAdmin
  if ((role & ~allFlags) !== 0) throw new Error('Il ruolo contiene permessi non riconosciuti.')
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
