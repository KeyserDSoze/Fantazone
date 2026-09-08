import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(process.argv[2] ?? process.cwd())
const outputPath = join(root, '.fantazone', 'offline', 'group-snapshot.json.gz')
const files = {}

for (const absolutePath of walk(root)) {
  const repositoryPath = relative(root, absolutePath).split(sep).join('/')
  if (!repositoryPath.toLowerCase().endsWith('.json')) continue
  if (repositoryPath.startsWith('.fantazone/offline/')) continue

  const raw = readFileSync(absolutePath, 'utf8')
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    continue
  }

  const sha = execFileSync('git', ['hash-object', '--', repositoryPath], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  files[repositoryPath] = {
    sha,
    value,
    bytes: Buffer.byteLength(raw),
  }
}

const orderedFiles = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))
const payload = Buffer.from(JSON.stringify({ version: 1, files: orderedFiles }))
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, gzipSync(payload, { level: 9, mtime: 0 }))
console.log(`Offline group pack: ${Object.keys(orderedFiles).length} JSON documents, ${payload.byteLength} bytes before gzip.`)

function* walk(directory) {
  for (const entry of readdirSync(directory).sort()) {
    if (entry === '.git') continue
    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) yield* walk(absolutePath)
    else if (stats.isFile()) yield absolutePath
  }
}
