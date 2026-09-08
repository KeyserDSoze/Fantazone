import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { createMigrationContext, planMigrationRecord } from './migration-plan.mjs'

const STATE_VERSION = 1

function now() { return new Date().toISOString() }
function recordId(record) { return `${record.container.toLowerCase()}/${record.blobName}` }
function sha256Text(value) { return createHash('sha256').update(value).digest('hex') }
function recordFingerprint(record) { return sha256Text(JSON.stringify([record.key ?? null, record.value ?? null])) }
function contentFingerprint(content) { return sha256Text(content) }
function targetKey(target, path) { return `${target}:${path}` }

function sameIdentity(left, right) {
  return left?.sourceFingerprint === right?.sourceFingerprint &&
    left?.groupRepository === right?.groupRepository &&
    left?.platformRepository === right?.platformRepository &&
    left?.branch === right?.branch &&
    left?.selectedGroupId === right?.selectedGroupId
}

function targetRoot(workDir, target) {
  return resolve(workDir, target === 'group' ? 'group-repo' : 'platform-repo')
}

function safeOutputPath(root, relativePath) {
  const base = resolve(root)
  const target = resolve(base, ...String(relativePath).split('/'))
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`Unsafe staged path '${relativePath}'`)
  return target
}

async function exists(path) {
  try { await stat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rm(path, { force: true }).catch(() => {})
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function writeJsonAtomic(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function loadState(statePath) {
  try { return JSON.parse(await readFile(statePath, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw new Error(`Cannot read migration staging state '${statePath}': ${error.message}`) }
}

async function replayJournal(journalPath) {
  let text = ''
  try { text = await readFile(journalPath, 'utf8') }
  catch (error) { if (error?.code === 'ENOENT') return { completed: new Map(), skipped: new Map() }; throw error }

  const lines = text.split('\n')
  const completed = new Map(), skipped = new Map(), lastFileContent = new Map()
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    let event
    try { event = JSON.parse(line) }
    catch (error) {
      const remaining = lines.slice(index + 1).some(value => value.trim())
      if (!remaining) break // tolerate an interrupted final append
      throw new Error(`Invalid migration progress journal at line ${index + 1}: ${error.message}`)
    }
    if (!event?.recordId) continue
    if (event.type === 'file') {
      const prior = lastFileContent.get(event.recordId) ?? null
      if (!event.previousContentSha256 && prior && prior !== event.contentSha256) {
        event = { ...event, previousContentSha256: prior }
      }
      if (event.contentSha256) lastFileContent.set(event.recordId, event.contentSha256)
      completed.set(event.recordId, event)
      skipped.delete(event.recordId)
    } else if (event.type === 'skip') {
      skipped.set(event.recordId, event)
      completed.delete(event.recordId)
    } else if (event.type === 'invalidate') {
      completed.delete(event.recordId)
      skipped.delete(event.recordId)
      // Keep lastFileContent: old 0.3.1 journals did not persist previousContentSha256
      // on the replacement file event, so its predecessor is reconstructed here.
    }
  }
  return { completed, skipped }
}

async function appendJournal(journalPath, event) {
  await mkdir(dirname(journalPath), { recursive: true })
  await appendFile(journalPath, `${JSON.stringify(event)}\n`, 'utf8')
}

async function stagedFileIsValid(workDir, event) {
  const root = targetRoot(workDir, event.target)
  const path = safeOutputPath(root, event.path)
  try {
    const content = await readFile(path, 'utf8')
    return contentFingerprint(content) === event.contentSha256
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function initialState(identity, workDir) {
  return {
    version: STATE_VERSION,
    createdAt: now(), updatedAt: now(), status: 'running',
    identity,
    workDir,
    totalRecords: 0, processedRecords: 0, convertedRecords: 0, skippedRecords: 0, resumedRecords: 0,
    groupFiles: 0, platformFiles: 0,
    currentRecord: null,
    lastError: null,
    git: null,
  }
}

async function prepareWorkspace(workDir, identity, reset) {
  if (reset) await rm(workDir, { recursive: true, force: true })
  await mkdir(targetRoot(workDir, 'group'), { recursive: true })
  await mkdir(targetRoot(workDir, 'platform'), { recursive: true })
  const statePath = resolve(workDir, 'state.json')
  const journalPath = resolve(workDir, 'progress.ndjson')
  let state = await loadState(statePath)
  if (!state) {
    if (await exists(journalPath)) throw new Error(`Found progress journal without state at '${workDir}'. Use -ResetWork to rebuild this staging directory safely.`)
    state = initialState(identity, workDir)
    await writeJsonAtomic(statePath, state)
  } else {
    if (state.version !== STATE_VERSION) throw new Error(`Migration staging version mismatch at '${workDir}'. Use -ResetWork.`)
    if (!sameIdentity(state.identity, identity)) throw new Error(`Migration staging at '${workDir}' belongs to another source/target selection. Use -ResetWork or choose another -WorkDir.`)
  }
  const journal = await replayJournal(journalPath)
  return { statePath, journalPath, state, ...journal }
}

async function loadStagedFiles(workDir, completed, currentRecordIds, target) {
  const files = []
  for (const event of completed.values()) {
    if (event.target !== target || !currentRecordIds.has(event.recordId)) continue
    const path = safeOutputPath(targetRoot(workDir, target), event.path)
    const content = await readFile(path, 'utf8')
    if (contentFingerprint(content) !== event.contentSha256) throw new Error(`Staged file changed unexpectedly: ${event.path}. Use -ResetWork or restore the staged file.`)
    files.push({
      path: event.path,
      content,
      source: event.source,
      previousContentSha256: event.previousContentSha256 ?? null,
    })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

function summarizeSkipped(skipped, currentRecordIds) {
  return [...skipped.values()]
    .filter(event => currentRecordIds.has(event.recordId) && event.reason !== 'other-group')
    .map(event => ({ container: event.container, blobName: event.blobName, reason: event.reason }))
}

async function removePriorOutput(workDir, event, pathOwners) {
  if (!event?.path || !event?.target) return
  const ownerKey = targetKey(event.target, event.path)
  if (pathOwners.get(ownerKey) === event.recordId) pathOwners.delete(ownerKey)
  await rm(safeOutputPath(targetRoot(workDir, event.target), event.path), { force: true }).catch(() => {})
}

/**
 * Convert records one at a time into git-ready local repository trees. The append-only journal is
 * the durable checkpoint; state.json is a human-readable summary. A failed mapper never discards
 * files produced by earlier records.
 */
export async function stageMigrationRecords(records, options) {
  const context = createMigrationContext(records, options)
  const workDir = resolve(options.workDir)
  const identity = {
    sourceFingerprint: options.sourceFingerprint ?? null,
    groupRepository: options.groupRepository,
    platformRepository: options.platformRepository,
    branch: options.branch ?? 'main',
    selectedGroupId: context.group.id,
  }
  const workspace = await prepareWorkspace(workDir, identity, Boolean(options.resetWork))
  const completed = workspace.completed, skipped = workspace.skipped
  const pathOwners = new Map()
  for (const event of completed.values()) pathOwners.set(targetKey(event.target, event.path), event.recordId)

  const currentRecordIds = new Set(records.map(recordId))
  let processed = 0, convertedThisRun = 0, skippedThisRun = 0, resumed = 0
  let lastProgressAt = 0

  options.onProgress?.({ type: 'workspace', workDir, completed: completed.size, skipped: skipped.size, total: records.length })

  const saveState = async (status, currentRecord = null, error = null) => {
    const activeCompleted = [...completed.values()].filter(event => currentRecordIds.has(event.recordId))
    const activeSkipped = [...skipped.values()].filter(event => currentRecordIds.has(event.recordId))
    const state = {
      ...workspace.state,
      version: STATE_VERSION,
      updatedAt: now(), status, identity, workDir,
      totalRecords: records.length,
      processedRecords: processed,
      convertedRecords: activeCompleted.length,
      skippedRecords: activeSkipped.length,
      resumedRecords: resumed,
      groupFiles: activeCompleted.filter(event => event.target === 'group').length,
      platformFiles: activeCompleted.filter(event => event.target === 'platform').length,
      currentRecord,
      lastError: error ? { message: error.message, at: now() } : null,
    }
    workspace.state = state
    await writeJsonAtomic(workspace.statePath, state)
  }

  try {
    for (const record of records) {
      const id = recordId(record)
      const sourceSha256 = recordFingerprint(record)
      const previousFile = completed.get(id)
      const previousSkip = skipped.get(id)

      if (previousFile && previousFile.sourceSha256 === sourceSha256 && await stagedFileIsValid(workDir, previousFile)) {
        processed += 1; resumed += 1
      } else if (previousSkip && previousSkip.sourceSha256 === sourceSha256) {
        processed += 1; resumed += 1
      } else {
        if (previousFile || previousSkip) {
          await appendJournal(workspace.journalPath, { type: 'invalidate', recordId: id, at: now() })
          if (previousFile) await removePriorOutput(workDir, previousFile, pathOwners)
          completed.delete(id); skipped.delete(id)
        }

        let planned
        try { planned = planMigrationRecord(record, context) }
        catch (error) {
          await saveState('failed', id, error)
          options.onProgress?.({ type: 'failed', recordId: id, processed, total: records.length, error })
          throw error
        }

        if (planned.kind === 'skip') {
          const event = {
            type: 'skip', recordId: id, sourceSha256,
            container: record.container.toLowerCase(), blobName: record.blobName,
            reason: planned.reason, at: now(),
          }
          await appendJournal(workspace.journalPath, event)
          skipped.set(id, event)
          skippedThisRun += 1
        } else {
          const file = planned.file
          const ownerKey = targetKey(planned.target, file.path)
          const owner = pathOwners.get(ownerKey)
          if (owner && owner !== id) throw new Error(`Multiple legacy blobs map to '${file.path}': ${owner} and ${id}`)

          const root = targetRoot(workDir, planned.target)
          const outputPath = safeOutputPath(root, file.path)
          const contentSha256 = contentFingerprint(file.content)
          if (await exists(outputPath)) {
            const existing = await readFile(outputPath, 'utf8')
            if (contentFingerprint(existing) !== contentSha256 && !owner) {
              throw new Error(`Untracked staged file collision at '${file.path}'. Use -ResetWork or move the existing staging directory.`)
            }
          }
          await writeAtomic(outputPath, file.content)
          const previousContentSha256 = previousFile?.target === planned.target && previousFile?.path === file.path
            ? previousFile.contentSha256
            : null
          const event = {
            type: 'file', recordId: id, sourceSha256, target: planned.target,
            path: file.path, source: file.source, contentSha256, previousContentSha256, at: now(),
          }
          await appendJournal(workspace.journalPath, event)
          completed.set(id, event)
          pathOwners.set(ownerKey, id)
          convertedThisRun += 1
        }
        processed += 1
      }

      const elapsedSinceProgress = Date.now() - lastProgressAt
      if (processed === 1 || processed % 100 === 0 || elapsedSinceProgress >= 2000 || processed === records.length) {
        options.onProgress?.({
          type: 'progress', recordId: id, processed, total: records.length,
          convertedThisRun, skippedThisRun, resumed,
          groupFiles: [...completed.values()].filter(event => event.target === 'group' && currentRecordIds.has(event.recordId)).length,
          platformFiles: [...completed.values()].filter(event => event.target === 'platform' && currentRecordIds.has(event.recordId)).length,
        })
        await saveState('running', id, null)
        lastProgressAt = Date.now()
      }
    }

    await saveState('ready', null, null)
    const groupFiles = await loadStagedFiles(workDir, completed, currentRecordIds, 'group')
    const platformFiles = await loadStagedFiles(workDir, completed, currentRecordIds, 'platform')
    const result = {
      group: context.group,
      groupFiles,
      platformFiles,
      skipped: summarizeSkipped(skipped, currentRecordIds),
      staging: {
        workDir,
        statePath: workspace.statePath,
        journalPath: workspace.journalPath,
        groupTree: targetRoot(workDir, 'group'),
        platformTree: targetRoot(workDir, 'platform'),
        convertedThisRun, skippedThisRun, resumed,
      },
    }
    options.onProgress?.({ type: 'complete', processed, total: records.length, ...result.staging, groupFiles: groupFiles.length, platformFiles: platformFiles.length })
    return result
  } catch (error) {
    if (workspace.state.status !== 'failed') await saveState('failed', workspace.state.currentRecord, error).catch(() => {})
    throw error
  }
}

export async function markStagingGitResult(workDir, git) {
  const root = resolve(workDir)
  const statePath = resolve(root, 'state.json')
  const state = await loadState(statePath)
  if (!state) throw new Error(`Missing staging state at '${statePath}'`)
  state.updatedAt = now()
  state.status = 'applied'
  state.currentRecord = null
  state.lastError = null
  state.git = git
  await writeJsonAtomic(statePath, state)
}
