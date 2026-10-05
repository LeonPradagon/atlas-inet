import { createHash } from 'node:crypto'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = join(root, 'var', 'routing')
const activeFile = join(base, 'active.json')
const defaultPbfUrl = 'https://download.geofabrik.de/asia/indonesia-latest.osm.pbf'
const jarUrl = 'https://repo.maven.apache.org/maven2/com/graphhopper/graphhopper-web/11.0/graphhopper-web-11.0.jar'
const jarSha256 = 'b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def'
const exists = (path) => access(path).then(() => true, () => false)

async function download(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(900_000) })
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }))
}

async function hash(path, algorithm) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function setup() {
  const pbfUrl = process.env.ROUTING_OSM_PBF_URL || defaultPbfUrl
  const customExtract = pbfUrl !== defaultPbfUrl
  const smallPilot = process.env.ROUTING_PROFILE === 'small'
  if (process.env.ROUTING_PROFILE && !['standard', 'small'].includes(process.env.ROUTING_PROFILE)) throw new Error('ROUTING_PROFILE must be standard or small.')
  if (smallPilot && !customExtract) throw new Error('The small profile requires an explicit regional ROUTING_OSM_PBF_URL; national extract is not allowed.')
  const confirmation = customExtract ? 'PILOT' : 'INDONESIA'
  const requiredConfirmation = smallPilot ? 'SMALL_PILOT' : confirmation
  const parsedPbfUrl = new URL(pbfUrl)
  if (parsedPbfUrl.protocol !== 'https:' || parsedPbfUrl.hostname !== 'download.geofabrik.de' || !parsedPbfUrl.pathname.endsWith('.osm.pbf')) throw new Error('OSM source must be an HTTPS Geofabrik .osm.pbf URL.')
  if (process.env.ROUTING_SETUP_CONFIRM !== requiredConfirmation) throw new Error(`Review OSM extract and host resources, then set ROUTING_SETUP_CONFIRM=${requiredConfirmation}.`)
  if (await exists(activeFile)) throw new Error('Active routing installation exists. No files changed; updates require a separate versioned installation.')
  const javaVersion = spawnSync(process.env.JAVA_BIN || 'java', ['-version'], { encoding: 'utf8' })
  const versionText = `${javaVersion.stdout || ''}\n${javaVersion.stderr || ''}`
  const javaMajor = versionText.match(/version "(?:1\.)?(\d+)/)?.[1]
  if (javaVersion.status !== 0 || !javaMajor || Number(javaMajor) < 25) throw new Error('GraphHopper 11 requires Java 25 or newer.')
  await mkdir(base, { recursive: true })
  const freeDiskGb = Number(process.env.ROUTING_MIN_FREE_DISK_GB || (smallPilot ? 20 : 80))
  const minimumRamGb = Number(process.env.ROUTING_MIN_RAM_GB || (smallPilot ? 6 : 16))
  if (!Number.isFinite(freeDiskGb) || freeDiskGb <= 0 || !Number.isFinite(minimumRamGb) || minimumRamGb <= 0) throw new Error('Routing RAM/disk thresholds must be positive numbers.')
  const availableDisk = Number(execFileSync('df', ['-Pk', base], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3]) / 1024 / 1024
  const memoryGb = totalmem() / 1024 ** 3
  if (availableDisk < freeDiskGb) throw new Error(`Need ${freeDiskGb} GB free disk; found ${availableDisk.toFixed(1)} GB.`)
  if (memoryGb < minimumRamGb) throw new Error(`Need at least ${minimumRamGb} GB RAM; found ${memoryGb.toFixed(1)} GB.`)

  const area = (process.env.ROUTING_DATASET_NAME || (customExtract ? basename(parsedPbfUrl.pathname).replace(/\.osm\.pbf$/, '') : 'indonesia')).replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!area) throw new Error('ROUTING_DATASET_NAME must contain at least one safe character.')
  const directory = await mkdtemp(join(base, `${area}-`))
  const jar = join(directory, 'graphhopper-web-11.0.jar')
  const pbf = join(directory, basename(parsedPbfUrl.pathname))
  console.log(`Downloading pinned GraphHopper 11.0 and OSM extract “${area}”. Graph import can take hours and use substantial memory/disk.`)
  const checksumResponse = await fetch(`${pbfUrl}.md5`, { signal: AbortSignal.timeout(30_000) })
  if (!checksumResponse.ok) throw new Error('Cannot obtain OSM checksum; installation not activated.')
  const expectedMd5 = (await checksumResponse.text()).trim().split(/\s+/)[0]
  if (!/^[a-f0-9]{32}$/i.test(expectedMd5)) throw new Error('Invalid Geofabrik checksum response.')
  await Promise.all([download(jarUrl, jar), download(pbfUrl, pbf)])
  if (await hash(jar, 'sha256') !== jarSha256) throw new Error('GraphHopper jar SHA-256 mismatch.')
  if ((await hash(pbf, 'md5')).toLowerCase() !== expectedMd5.toLowerCase()) throw new Error('OSM extract checksum mismatch.')
  const pbfSha256 = await hash(pbf, 'sha256')
  const config = `graphhopper:\n  datareader.file: ${pbf}\n  graph.location: ${join(directory, 'graph-cache')}\n  profiles:\n    - name: car\n      custom_model_files: [car.json]\n    - name: car_shortest\n      custom_model_files: [car.json, shortest.json]\n  profiles_ch:\n    - profile: car\n  profiles_lm: []\n  graph.encoded_values: car_access, car_average_speed, road_access\n  prepare.min_network_size: 200\n  routing.max_visited_nodes: 1000000\n  routing.snap_preventions_default: tunnel, bridge, ferry\n  import.osm.ignored_highways: footway,construction,cycleway,path,steps\n  graph.dataaccess.default_type: RAM_STORE\nserver:\n  application_connectors:\n    - type: http\n      port: 8989\n      bind_host: 127.0.0.1\n  admin_connectors:\n    - type: http\n      port: 8990\n      bind_host: 127.0.0.1\nlogging:\n  appenders:\n    - type: console\n      time_zone: UTC\n`
  await writeFile(join(directory, 'config.yml'), config, { flag: 'wx' })
  await writeFile(join(directory, 'shortest.json'), JSON.stringify({ distance_influence: 1000 }, null, 2), { flag: 'wx' })
  const manifest = { version: 'graphhopper-11.0', profile: smallPilot ? 'small' : 'standard', javaXms: smallPilot ? '512m' : '2g', javaXmx: smallPilot ? '4g' : '12g', area, sourceUrl: pbfUrl, directory, jar, pbf, pbfSha256, roadDatasetVersion: `geofabrik-${area}:sha256:${pbfSha256}` }
  await writeFile(activeFile, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(`Artifacts verified. Dataset: ${manifest.roadDatasetVersion}`)
  console.log(`Profile: ${manifest.profile}; Java heap: ${manifest.javaXms}–${manifest.javaXmx}. A small profile only reduces resource limits; choose a genuinely small regional extract and monitor import for out-of-memory.`)
  console.log('Next: npm run routing:start. First start builds graph; wait for “Routing gateway ready”.')
}

function routeGateway(manifest) {
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    if (request.method !== 'POST' || request.url !== '/route') { response.writeHead(404).end('{}'); return }
    try {
      let body = ''
      for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error() }
      const input = JSON.parse(body)
      const point = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
      const from = [input.from?.longitude, input.from?.latitude]
      const to = input.to?.coordinates
      if (!point(from) || !point(to)) throw new Error()
      const getPath = async (profile) => {
        const result = await fetch('http://127.0.0.1:8989/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: [from, to], profile, ...(profile === 'car_shortest' ? { 'ch.disable': true } : {}), points_encoded: false, instructions: false }), signal: AbortSignal.timeout(30_000) })
        if (!result.ok) throw new Error()
        const path = (await result.json()).paths?.[0]
        const coords = path?.points?.coordinates
        if (!Number.isFinite(path?.distance) || !Array.isArray(coords) || coords.length < 2 || coords.length > 10_000 || !coords.every(point)) throw new Error()
        return { distance: path.distance, coordinates: coords }
      }
      const [route, shortest] = await Promise.all([getPath('car'), getPath('car_shortest')])
      response.writeHead(200).end(JSON.stringify({ distanceM: route.distance, shortestFeasibleDistanceM: shortest.distance, policyVersion: 'graphhopper-11.0-car-vs-distance-influence-1000-v1', roadDatasetVersion: manifest.roadDatasetVersion, geometry: { type: 'LineString', coordinates: route.coordinates } }))
    } catch { response.writeHead(503).end(JSON.stringify({ error: 'routing_unavailable' })) }
  })
  const bindHost = process.env.ROUTING_GATEWAY_BIND || '127.0.0.1'
  return new Promise((resolve, reject) => server.listen(2323, bindHost, () => { console.log(`Routing gateway ready at http://${bindHost}:2323/route.`); resolve(server) }).once('error', reject))
}

async function start() {
  if (!await exists(activeFile)) throw new Error('Run npm run routing:setup on approved routing host first.')
  const manifest = JSON.parse(await readFile(activeFile, 'utf8'))
  const existing = await fetch('http://127.0.0.1:8989/info', { signal: AbortSignal.timeout(1000) }).catch(() => null)
  if (existing?.ok) throw new Error('GraphHopper already responds on port 8989; refusing duplicate start.')
  const java = spawn(process.env.JAVA_BIN || 'java', [`-Xms${manifest.javaXms || '2g'}`, `-Xmx${manifest.javaXmx || '12g'}`, '-jar', manifest.jar, 'server', join(manifest.directory, 'config.yml')], { cwd: manifest.directory, stdio: 'inherit' })
  let gateway
  const stop = () => { gateway?.close(); java.kill('SIGTERM') }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    for (let attempt = 0; attempt < 360; attempt++) {
      if (java.exitCode !== null) throw new Error(`GraphHopper exited with code ${java.exitCode}`)
      const health = await fetch('http://127.0.0.1:8989/info', { signal: AbortSignal.timeout(1000) }).catch(() => null)
      if (health?.ok) { gateway = await routeGateway(manifest); return }
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
    throw new Error('GraphHopper did not become ready within one hour.')
  } catch (error) { java.kill('SIGTERM'); throw error }
}

try {
  if (process.argv[2] === 'setup') await setup()
  else if (process.argv[2] === 'start') await start()
  else throw new Error('Expected setup or start.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Routing command failed')
  process.exitCode = 1
}
