import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(process.cwd())
const sourceRoot = join(root, 'data', 'serie-a')
const outputRoot = join(root, 'src', 'app', 'dist', 'offline', 'serie-a')

const files = await walk(sourceRoot)
const bySeason = new Map()

for (const absolutePath of files) {
  if (!absolutePath.endsWith('.json')) continue
  const repositoryPath = relative(root, absolutePath).split(sep).join('/')
  const season = extractSeason(repositoryPath)
  if (season == null) continue
  const value = JSON.parse(await readFile(absolutePath, 'utf8'))
  const bucket = bySeason.get(season) ?? []
  bucket.push([repositoryPath, value])
  bySeason.set(season, bucket)
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const packs = {}
for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
  const entries = bySeason.get(season).sort((a, b) => a[0].localeCompare(b[0]))
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    season,
    files: Object.fromEntries(entries),
  }))
  const compressed = gzipSync(payload, { level: 9 })
  const hash = createHash('sha256').update(compressed).digest('hex')
  const filename = `${season}.json.gz`
  await writeFile(join(outputRoot, filename), compressed)
  packs[String(season)] = {
    url: `/offline/serie-a/${filename}`,
    hash,
    files: entries.length,
    bytes: compressed.byteLength,
  }
}

await writeFile(join(outputRoot, 'index.json'), `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  packs,
}, null, 2)}\n`)

console.log(`Built ${Object.keys(packs).length} offline Serie A season packs in ${relative(root, outputRoot)}`)

async function walk(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(absolutePath))
    else if (entry.isFile()) result.push(absolutePath)
  }
  return result
}

function extractSeason(repositoryPath) {
  const relativePath = repositoryPath.replace(/^data\/serie-a\//, '')
  const match = relativePath.match(/(?:^|\/)(\d+)(?:\.json|\/)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isInteger(value) && value > 0 ? value : null
}
