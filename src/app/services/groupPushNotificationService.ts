import {
  GroupHelper,
  IdentityRole,
  addPushSubscription,
  emptyPushNotificationSettings,
  normalizePushEmail,
  removePushSubscription,
  withPushPreferences,
  type PushNotificationPreferences,
  type PushNotificationSettings,
  type PushSubscription,
  type UserOfAGroup,
} from '@fantazone/domain'
import {
  GitHubClient,
  GitHubPushNotificationRepository,
  GROUP_PUSH_SCRIPT,
  GROUP_PUSH_SCRIPT_PATH,
  GROUP_PUSH_TRANSPORT_VERSION,
  GROUP_PUSH_WORKFLOW,
  GROUP_PUSH_WORKFLOW_PATH,
} from '@fantazone/github'
import type { GroupSessionRuntime } from './groupSessionRuntime'

export type PushTransportStatus = {
  installed: boolean
  current: boolean
  version: number
}

export class GroupPushNotificationService {
  private readonly repository: GitHubPushNotificationRepository

  constructor(private readonly runtime: GroupSessionRuntime) {
    this.repository = new GitHubPushNotificationRepository(runtime.store, runtime.target)
  }

  async getSettings(email: string, refresh = false): Promise<PushNotificationSettings> {
    return this.repository.get(email, refresh ? { refresh: true } : {})
  }

  async savePreferences(email: string, preferences: PushNotificationPreferences): Promise<PushNotificationSettings> {
    const normalized = normalizePushEmail(email)
    await this.requireActiveMember(normalized)
    const snapshot = await this.repository.getSnapshot(normalized, { refresh: true })
    const base = snapshot?.value ?? emptyPushNotificationSettings(normalized)
    const next = withPushPreferences(base, preferences)
    await this.repository.write(next, 'chore: update push notification preferences', snapshot
      ? { expectedSha: snapshot.sha }
      : { createOnly: true })
    return next
  }

  async registerSubscription(email: string, subscription: PushSubscription): Promise<PushNotificationSettings> {
    const normalized = normalizePushEmail(email)
    await this.requireActiveMember(normalized)
    const snapshot = await this.repository.getSnapshot(normalized, { refresh: true })
    const base = snapshot?.value ?? emptyPushNotificationSettings(normalized)
    const next = addPushSubscription(base, subscription)
    await this.repository.write(next, 'chore: register Web Push device', snapshot
      ? { expectedSha: snapshot.sha }
      : { createOnly: true })
    return next
  }

  async unregisterSubscription(email: string, endpoint: string): Promise<PushNotificationSettings> {
    const normalized = normalizePushEmail(email)
    await this.requireActiveMember(normalized)
    const snapshot = await this.repository.getSnapshot(normalized, { refresh: true })
    const base = snapshot?.value ?? emptyPushNotificationSettings(normalized)
    const next = removePushSubscription(base, endpoint)
    if (!snapshot) return next
    await this.repository.write(next, 'chore: unregister Web Push device', { expectedSha: snapshot.sha })
    return next
  }

  async getTransportStatus(): Promise<PushTransportStatus> {
    const client = new GitHubClient(this.runtime.connection.token)
    const branch = this.runtime.target.ref ?? this.runtime.connection.repository.default_branch
    const [workflow, script] = await Promise.all([
      client.tryGetContent(this.runtime.target.owner, this.runtime.target.repo, GROUP_PUSH_WORKFLOW_PATH, branch),
      client.tryGetContent(this.runtime.target.owner, this.runtime.target.repo, GROUP_PUSH_SCRIPT_PATH, branch),
    ])
    return {
      installed: Boolean(workflow && script),
      current: workflow?.content === GROUP_PUSH_WORKFLOW && script?.content === GROUP_PUSH_SCRIPT,
      version: GROUP_PUSH_TRANSPORT_VERSION,
    }
  }

  async installTransport(actor: UserOfAGroup): Promise<PushTransportStatus> {
    const group = await this.runtime.refreshGroup()
    const freshActor = GroupHelper.findUserByEmail(group, actor.email)
    if (!freshActor || !GroupHelper.hasRole(freshActor, IdentityRole.SuperAdmin)) {
      throw new Error('Solo un SuperAdmin può installare o aggiornare il trasporto Web Push del gruppo.')
    }
    const client = new GitHubClient(this.runtime.connection.token)
    const branch = this.runtime.target.ref ?? this.runtime.connection.repository.default_branch
    await writeManagedFile(client, this.runtime.target.owner, this.runtime.target.repo, branch, GROUP_PUSH_SCRIPT_PATH, GROUP_PUSH_SCRIPT)
    await writeManagedFile(client, this.runtime.target.owner, this.runtime.target.repo, branch, GROUP_PUSH_WORKFLOW_PATH, GROUP_PUSH_WORKFLOW)
    return this.getTransportStatus()
  }

  async dispatchTest(email: string): Promise<void> {
    const normalized = normalizePushEmail(email)
    await this.requireActiveMember(normalized)
    const settings = await this.repository.get(normalized, { refresh: true })
    if (settings.subscriptions.length === 0) throw new Error('Nessun dispositivo Web Push registrato per questo utente.')
    const transport = await this.getTransportStatus()
    if (!transport.current) throw new Error('Il trasporto Web Push del gruppo deve essere installato o aggiornato prima del test.')
    const branch = this.runtime.target.ref ?? this.runtime.connection.repository.default_branch
    await new GitHubClient(this.runtime.connection.token).dispatchWorkflow(
      this.runtime.target.owner,
      this.runtime.target.repo,
      GROUP_PUSH_WORKFLOW_PATH,
      branch,
      {
        email: normalized,
        title: 'FantaZone',
        body: 'Notifiche Web Push configurate correttamente.',
        url: 'https://fanta.plus',
      },
    )
  }

  private async requireActiveMember(email: string): Promise<void> {
    const group = await this.runtime.refreshGroup()
    const member = GroupHelper.findUserByEmail(group, email)
    if (!member || member.role === IdentityRole.None) throw new Error('Utente non attivo nel gruppo selezionato.')
  }
}

async function writeManagedFile(
  client: GitHubClient,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
): Promise<void> {
  const existing = await client.tryGetContent(owner, repo, path, branch)
  if (existing?.content === content) return
  await client.putContent(owner, repo, path, content, `chore: install Fantazone push transport v${GROUP_PUSH_TRANSPORT_VERSION}`, existing?.sha, branch)
}
