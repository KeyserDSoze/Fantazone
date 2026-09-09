import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { scanAzureStorage } from '../../scripts/migration/azure-source.mjs'
import { writeMigrationErrorSnapshot } from '../../scripts/migration/error-snapshot.mjs'
import { normalizeLegacyRealCalendarRecord } from '../../scripts/migration/real-calendar-source.mjs'
import { stageMigrationRecords } from '../../scripts/migration/staging.mjs'

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-calendar-diagnostics-'))
  try { await fn(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('missing or zero RealCalendar years are repaired from the Azure/Rystem key', () => {
  const normalized = normalizeLegacyRealCalendarRecord({
    container: 'realcalendar',
    blobName: '12',
    key: 12,
    value: {
      d: [
        {
          y: 0,
          a: 1,
          g: [
            {
              h: { n: 'Empoli', a: 'emp' },
              a: { n: 'Verona', a: 'ver' },
              d: '2023-08-19T18:30:00Z',
              g: 0,
              y: 1,
              e: false,
            },
          ],
        },
      ],
    },
  })

  assert.equal(normalized.ok, true)
  assert.equal(normalized.repaired, true)
  assert.equal(normalized.record.value.y, 12)
  assert.equal(normalized.record.value.d[0].y, 12)
})

test('unrecoverable RealCalendar reaches staging and last-error.json keeps the original source payload', async () => {
  await fixture(async workDir => {
    const wrongSeasonPayload = {
      y: 13,
      d: [
        {
          y: 13,
          a: 1,
          g: [
            {
              h: { n: 'Genoa', a: 'gen' },
              a: { n: 'Inter', a: 'int' },
              d: '2024-08-17T18:30:00Z',
              g: null,
              y: null,
              e: false,
            },
          ],
        },
      ],
    }
    const rawText = JSON.stringify(wrongSeasonPayload)
    const client = {
      async *listContainers() { yield { name: 'realcalendar' } },
      getContainerClient() {
        return {
          async *listBlobsFlat(options = {}) {
            if (options.includeVersions || options.includeSnapshots) return
            yield {
              name: '12',
              properties: {
                contentLength: rawText.length,
                lastModified: new Date('2026-09-09T06:00:00Z'),
                etag: 'wrong-season',
              },
            }
          },
          getBlobClient() {
            return {
              async download() {
                return { readableStreamBody: Readable.from([rawText]) }
              },
            }
          },
        }
      },
    }

    const scan = await scanAzureStorage('unused-for-injected-client', { client })
    assert.equal(scan.issues.length, 1)
    assert.equal(scan.records.length, 1)
    const fatal = scan.records[0]
    assert.equal(fatal.container, 'realcalendar')
    assert.equal(fatal.key, 12)
    assert.equal(fatal.value, null)
    assert.deepEqual(fatal.migrationDiagnosticValue, wrongSeasonPayload)
    assert.match(fatal.migrationFatalIssue.detail, /does not match Azure\/Rystem key 12/)

    const groupRecord = {
      container: 'group',
      blobName: 'g',
      key: 'my-group',
      value: { i: 'my-group', n: 'My Group', l: [], u: [], b: [] },
    }
    const options = {
      workDir,
      sourceFingerprint: 'source-a',
      groupRepository: 'owner/Fantazone.My-Group',
      platformRepository: 'owner/Fantazone',
      branch: 'main',
    }

    let stagingError
    try {
      await stageMigrationRecords([groupRecord, fatal], options)
    } catch (error) {
      stagingError = error
    }
    assert.ok(stagingError)
    assert.match(stagingError.message, /legacy RealCalendar/)

    const snapshotPath = await writeMigrationErrorSnapshot({
      workDir,
      records: [groupRecord, fatal],
      args: options,
      error: stagingError,
    })
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    assert.equal(snapshot.source.recordId, 'realcalendar/12')
    assert.equal(snapshot.source.key, 12)
    assert.deepEqual(snapshot.source.value, wrongSeasonPayload)
    assert.equal(snapshot.source.issue.reason, 'invalid-realcalendar-season')
    assert.equal(snapshot.destination.path, 'data/serie-a/calendars/12.json')
  })
})

test('malformed RealCalendar JSON is preserved as rawText for last-error diagnostics', async () => {
  const malformed = '{"y":12,"d":['
  const client = {
    async *listContainers() { yield { name: 'realcalendar' } },
    getContainerClient() {
      return {
        async *listBlobsFlat(options = {}) {
          if (options.includeVersions || options.includeSnapshots) return
          yield { name: '12', properties: { contentLength: malformed.length, etag: 'broken-json' } }
        },
        getBlobClient() {
          return {
            async download() {
              return { readableStreamBody: Readable.from([malformed]) }
            },
          }
        },
      }
    },
  }

  const scan = await scanAzureStorage('unused-for-injected-client', { client })
  assert.equal(scan.records.length, 1)
  assert.equal(scan.records[0].value, null)
  assert.equal(scan.records[0].migrationRawText, malformed)
  assert.equal(scan.records[0].migrationFatalIssue.reason, 'invalid-realcalendar-json')
})
