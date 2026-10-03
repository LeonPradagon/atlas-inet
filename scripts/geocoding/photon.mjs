import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import * as zlib from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = join(root, 'var', 'geocoding')
const activeFile = join(base, 'active.json')
const jarUrl = 'https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar'
const jarSha256 = 'a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5'
const dumpUrl = 'https://download1.graphhopper.com/public/asia/indonesia/photon-dump-indonesia-1.0-latest.jsonl.zst'
const exists = (path) => access(path).then(() => true, () => false)
async function download(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }))
}
async function hash(path, algorithm) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}
function java(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.JAVA_BIN || 'java', args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Photon exited: ${code ?? signal}`)))
  })
}
async function setup() {
  if (await exists(activeFile)) {
    console.log('Existing Photon installation retained. No data was downloaded or overwritten.')
    return
  }
  if (typeof zlib.createZstdDecompress !== 'function') throw new Error('Setup requires Node.js with createZstdDecompress (Node 24+ recommended)')
  await java(['-version'], root)
  await mkdir(base, { recursive: true })
  // Photon import deletes the target index: only ever import into a NEW directory.
  const directory = await mkdtemp(join(base, 'indonesia-'))
  const jar = join(directory, 'photon-1.3.0.jar'), dump = join(directory, 'indonesia.jsonl.zst')
  console.log('Downloading Photon 1.3.0 (~98 MB) and Indonesia-only data (~176 MB). Customer addresses are not sent anywhere.')
  const checksumResponse = await fetch(`${dumpUrl}.md5`, { signal: AbortSignal.timeout(30_000) })
  if (!checksumResponse.ok) throw new Error('Cannot verify Indonesia dump checksum')
  const expectedMd5 = (await checksumResponse.text()).trim().split(/\s+/)[0]
  if (!/^[a-f0-9]{32}$/.test(expectedMd5)) throw new Error('Invalid upstream checksum')
  await Promise.all([download(jarUrl, jar), download(dumpUrl, dump)])
  if (await hash(jar, 'sha256') !== jarSha256) throw new Error('Photon jar checksum mismatch')
  if (await hash(dump, 'md5') !== expectedMd5) throw new Error('Dump checksum mismatch; the upstream latest dump may have changed. No installation activated.')
  const dumpSha256 = await hash(dump, 'sha256')
  const jsonl = join(directory, 'indonesia.jsonl')
  await pipeline(createReadStream(dump), zlib.createZstdDecompress(), createWriteStream(jsonl, { flags: 'wx' }))
  await java(['-Xms256m', '-Xmx1g', '-jar', jar, 'import', '-import-file', jsonl, '-country-codes', 'ID'], directory)
  if (!await exists(join(directory, 'photon_data'))) throw new Error('Photon import did not produce a database')
  const manifest = { version: '1.3.0', directory, jar, dumpUrl, dumpSha256, datasetVersion: `photon-indonesia:sha256:${dumpSha256}`, importedAt: new Date().toISOString() }
  // Exclusive create prevents concurrent setup from replacing an existing active installation.
  await writeFile(activeFile, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(`Photon Indonesia installed. Dataset: ${manifest.datasetVersion}`)
  console.log('Start: npm run geocoding:start')
  console.log('Backend .env: PHOTON_INTERNAL_URL=http://127.0.0.1:2322')
  console.log(`Backend .env: GEOCODING_DATASET_VERSION=${manifest.datasetVersion}`)
}
async function start() {
  if (!await exists(activeFile)) throw new Error('Run npm run geocoding:setup first')
  const manifest = JSON.parse(await readFile(activeFile, 'utf8'))
  const response = await fetch('http://127.0.0.1:2322/status', { signal: AbortSignal.timeout(1000) }).catch(() => null)
  if (response) throw new Error('Port 2322 is already responding; refusing to start another service')
  await java(['-Xms256m', '-Xmx1g', '-jar', manifest.jar, 'serve', '-listen-ip', '127.0.0.1', '-listen-port', '2322', '-max-results', '5'], manifest.directory)
}
try {
  if (process.argv[2] === 'setup') await setup()
  else if (process.argv[2] === 'start') await start()
  else throw new Error('Expected setup or start')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Photon command failed')
  process.exitCode = 1
}
