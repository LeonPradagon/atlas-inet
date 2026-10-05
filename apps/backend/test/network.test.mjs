import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { Client, Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { AppModule } from '../dist/app.module.js'
import { loadEnvironment } from '../dist/config/load-env.js'
import { loadAppConfig } from '../dist/config/app-config.js'
import { AuthService } from '../dist/modules/auth/auth.service.js'
import { createAuth } from '../dist/modules/auth/auth.js'
import { AccessProvisioner } from '../dist/modules/access/access-provisioner.js'
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js'
import * as schema from '../dist/database/schema/index.js'

test('network domain: PostGIS validation, viewport API, asset separation and entity isolation', async (t) => {
  loadEnvironment()
  const config = loadAppConfig()
  const originalUrl = process.env.DATABASE_URL
  const originalNodeEnv = process.env.NODE_ENV
  const databaseName = `atlas_network_test_${randomUUID().replaceAll('-', '')}`
  const databaseUrl = new URL(config.databaseUrl)
  databaseUrl.pathname = `/${databaseName}`
  const admin = new Client({ connectionString: config.databaseUrl })
  let created = false
  let pool
  let app
  let baselineFolder
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    pool = new Pool({ connectionString: databaseUrl.toString(), max: 3 })
    const db = drizzle(pool, { schema })
    const tempRoot = join(homedir(), 'AppData', 'Local', 'Temp', 'opencode')
    await mkdir(tempRoot, { recursive: true })
    baselineFolder = await mkdtemp(join(tempRoot, 'atlas-network-baseline-'))
    await mkdir(join(baselineFolder, 'meta'))
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'))
    const entries = journal.entries.slice(0, 2)
    await writeFile(join(baselineFolder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const entry of entries) await copyFile(`drizzle/${entry.tag}.sql`, join(baselineFolder, `${entry.tag}.sql`))
    await migrate(db, { migrationsFolder: baselineFolder })

    const auth = createAuth(db, { ...config, databaseUrl: databaseUrl.toString(), nodeEnv: 'test' }, true)
    const password = `Test-only-${randomUUID()}`
    const alice = await auth.api.signUpEmail({ body: { email: 'alice@example.test', name: 'Alice', password } })
    await auth.api.signUpEmail({ body: { email: 'bob@example.test', name: 'Bob', password } })
    await auth.api.signUpEmail({ body: { email: 'unscoped@example.test', name: 'Admin', password } })
    const grants = new AccessProvisioner(db)
    const alphaInput = { email: 'alice@example.test', entityCode: 'ALPHA', entityName: 'Test Alpha', roleCode: 'network-reader', permissions: ['network.read'], source: 'integration-test' }
    const alpha = await grants.grant(alphaInput)
    const beta = await grants.grant({ ...alphaInput, email: 'bob@example.test', entityCode: 'BETA', entityName: 'Test Beta' })
    await grants.grant({ ...alphaInput, entityCode: 'BETA', entityName: 'Test Beta', roleCode: 'entity-reader', permissions: ['entities.read'] })
    await migrate(db, { migrationsFolder: 'drizzle' })
    await t.test('network migration preserves existing accounts and memberships', async () => {
      assert.equal(Number((await pool.query('SELECT count(*) FROM "user"')).rows[0].count), 3)
      assert.equal(Number((await pool.query('SELECT count(*) FROM memberships')).rows[0].count), 3)
      await migrate(db, { migrationsFolder: 'drizzle' })
      assert.equal(Number((await pool.query('SELECT count(*) FROM network_segments')).rows[0].count), 0)
    })

    async function dataset(ownerEntityId, version, status = 'PUBLISHED') {
      const [row] = await db.insert(schema.networkDatasets).values({ ownerEntityId, version, status, publishedAt: status === 'DRAFT' ? null : new Date(), sourceSystem: 'test-fixture', createdBy: alice.user.id }).returning()
      return row
    }
    const aDataset = await dataset(alpha.entityId, 'fixture-v1')
    const aDraft = await dataset(alpha.entityId, 'fixture-draft', 'DRAFT')
    const bDataset = await dataset(beta.entityId, 'fixture-v1')
    const [cableType] = await db.insert(schema.cableTypes).values({ code: 'FIXTURE_FO', name: 'Test cable type' }).returning()
    function geom(type, coordinates) {
      return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type, coordinates })}), 4326)`
    }
    async function point(table, code, longitude = 106.84, latitude = -6.2, extra = {}) {
      const [row] = await db.insert(table).values({ ownerEntityId: alpha.entityId, datasetId: aDataset.id, code, geometry: geom('Point', [longitude, latitude]), sourceSystem: 'test-fixture', createdBy: alice.user.id, ...extra }).returning()
      return row
    }
    const start = await point(schema.networkNodes, 'START', 106.8)
    const end = await point(schema.networkNodes, 'END', 106.9)
    const pole7 = await point(schema.poles, 'POLE7', 106.83, -6.21, { heightM: 7 })
    const pole9 = await point(schema.poles, 'POLE9', 106.86, -6.21, { heightM: 9 })
    const odc = await point(schema.odcs, 'ODC1', 106.83, -6.22)
    const odp = await point(schema.odps, 'ODP1', 106.86, -6.22)
    const bOdc = await point(schema.odcs, 'ODC1', 106.84, -6.2, { ownerEntityId: beta.entityId, datasetId: bDataset.id })
    const draftOdp = await point(schema.odps, 'DRAFT-ODP', 106.84, -6.2, { datasetId: aDraft.id })
    const segmentBase = {
      ownerEntityId: alpha.entityId, datasetId: aDataset.id, cableTypeId: cableType.id,
      installedCoreCount: 24, capacityValidated: true, installationMethod: 'AERIAL', roadSide: 'LEFT',
      startNodeId: start.id, endNodeId: end.id, geometry: geom('LineString', [[106.8, -6.2], [106.9, -6.2]]),
      sourceSystem: 'test-fixture', sourceFile: 'fixture.kml', createdBy: alice.user.id,
    }
    async function segment(code, extra = {}) {
      const [row] = await db.insert(schema.networkSegments).values({ ...segmentBase, segmentCode: code, cableName: `Fixture ${code}`, ...extra }).returning()
      return row
    }
    const main = await segment('AAA-MAIN', { externalId: 'stable-external-id' })
    const burial = await segment('BBB-BURIAL', { installationMethod: 'BURIAL' })
    const incomplete = await segment('CCC-INCOMPLETE', { cableTypeId: null, installedCoreCount: null, capacityValidated: false, installationMethod: null, roadSide: null, startNodeId: null, endNodeId: null })
    await segment('DDD-INACTIVE', { status: 'INACTIVE' })
    await segment('FAR', { geometry: geom('LineString', [[108, -6.2], [108.1, -6.2]]) })
    const draftSegment = await segment('DRAFT', { datasetId: aDraft.id, startNodeId: null, endNodeId: null, roadSide: null })
    const bSegment = await segment('B-SECRET', { ownerEntityId: beta.entityId, datasetId: bDataset.id, startNodeId: null, endNodeId: null, roadSide: null })
    for (const asset of [pole7, pole9]) await db.insert(schema.segmentPoles).values({ segmentId: main.id, assetId: asset.id, ownerEntityId: alpha.entityId, datasetId: aDataset.id })
    await db.insert(schema.segmentOdcs).values({ segmentId: main.id, assetId: odc.id, ownerEntityId: alpha.entityId, datasetId: aDataset.id })
    await db.insert(schema.segmentOdps).values({ segmentId: main.id, assetId: odp.id, ownerEntityId: alpha.entityId, datasetId: aDataset.id })

    await t.test('invalid geometry types, bounds, empty and zero-length lines are rejected', async () => {
      const shapes = ['POINT(106.84 -6.2)', 'LINESTRING EMPTY', 'LINESTRING(106.8 -6.2,106.8 -6.2)', 'LINESTRING(181 0,182 1)', 'LINESTRING(106 91,107 92)', 'POLYGON((0 0,1 0,1 1,0 0))']
      for (const shape of shapes) {
        await assert.rejects(segment(`INVALID-${randomUUID()}`, { geometry: sql`ST_GeomFromText(${shape}, 4326)` }), (error) => ['23514', '22023'].includes(error.cause?.code))
      }
      await assert.rejects(point(schema.odps, 'BAD-POINT', 106, 91), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('BAD-SRID', { geometry: sql`ST_GeomFromText('LINESTRING(0 0,1 1)', 3857)` }), (error) => error.cause?.code === '22023')
    })
    await t.test('installed capacity is positive when known; unknown capacity cannot be validated', async () => {
      for (const value of [0, -1]) await assert.rejects(segment(`BAD-CORE-${value}`, { installedCoreCount: value }), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('BAD-VALIDATED', { installedCoreCount: null, capacityValidated: true }), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('FRACTIONAL-CORE', { installedCoreCount: 1.5 }), (error) => error.cause?.code === '22P02')
    })
    await t.test('pole heights, installation enum and direction metadata are validated', async () => {
      await assert.rejects(point(schema.poles, 'BAD-HEIGHT', 106.84, -6.2, { heightM: 8 }), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('BAD-METHOD', { installationMethod: 'OTHER' }), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('BAD-SIDE', { roadSide: 'NORTH' }), (error) => error.cause?.code === '23514')
      await assert.rejects(segment('BAD-TOPOLOGY', { endNodeId: null }), (error) => error.cause?.code === '23514')
    })
    await t.test('duplicate source identity and codes are rejected without replacing existing assets', async () => {
      await assert.rejects(segment('OTHER', { externalId: 'stable-external-id' }), (error) => error.cause?.code === '23505')
      await assert.rejects(segment('AAA-MAIN'), (error) => error.cause?.code === '23505')
      await assert.rejects(point(schema.odcs, 'ODC1'), (error) => error.cause?.code === '23505')
    })
    await t.test('dataset ownership, asset links and topology cannot cross entity/version boundaries', async () => {
      await assert.rejects(segment('CROSS-DATASET', { datasetId: bDataset.id }), (error) => error.cause?.code === '23503')
      await assert.rejects(db.insert(schema.segmentOdcs).values({ segmentId: main.id, assetId: bOdc.id, ownerEntityId: alpha.entityId, datasetId: aDataset.id }), (error) => error.cause?.code === '23503')
      await assert.rejects(db.insert(schema.segmentOdps).values({ segmentId: main.id, assetId: draftOdp.id, ownerEntityId: alpha.entityId, datasetId: aDataset.id }), (error) => error.cause?.code === '23503')
      const otherNode = await point(schema.networkNodes, 'B-NODE', 106.8, -6.2, { ownerEntityId: beta.entityId, datasetId: bDataset.id })
      await assert.rejects(segment('CROSS-NODE', { startNodeId: otherNode.id }), (error) => error.cause?.code === '23503')
    })

    process.env.DATABASE_URL = databaseUrl.toString()
    process.env.NODE_ENV = 'test'
    app = await NestFactory.create(AppModule, { logger: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl()
    async function cookie(email) {
      const response = await app.get(AuthService).instance.api.signInEmail({ body: { email, password }, asResponse: true })
      assert.equal(response.status, 200)
      return response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ')
    }
    const aliceCookie = await cookie('alice@example.test')
    const bobCookie = await cookie('bob@example.test')
    const unscopedCookie = await cookie('unscoped@example.test')
    const get = (path, sessionCookie = aliceCookie) => fetch(`${origin}/api/v1/network${path}`, { headers: sessionCookie ? { Cookie: sessionCookie } : {} })
    const viewport = `entityId=${alpha.entityId}&bbox=106.81,-6.3,106.89,-6.1`

    await t.test('all network endpoints require an authenticated session', async () => {
      for (const path of [`/segments?${viewport}`, `/segments/${main.id}`, `/map?${viewport}`, `/search?entityId=${alpha.entityId}&q=ODC1`]) assert.equal((await get(path, '')).status, 401)
    })
    await t.test('viewport list is filtered, clipped and stably paginated with correct totals', async () => {
      const response = await get(`/segments?${viewport}&pageSize=2`)
      assert.equal(response.status, 200)
      const { data, meta } = await response.json()
      assert.deepEqual(data.map((row) => row.segmentCode), ['AAA-MAIN', 'BBB-BURIAL'])
      assert.deepEqual(meta, { page: 1, pageSize: 2, total: 4, geometryClipped: true })
      assert.ok(Math.abs(data[0].geometry.coordinates[0][0] - 106.81) < 1e-9)
      assert.ok(Math.abs(data[0].geometry.coordinates.at(-1)[0] - 106.89) < 1e-9)
      const second = await (await get(`/segments?${viewport}&pageSize=2&page=2`)).json()
      assert.deepEqual(second.data.map((row) => row.segmentCode), ['CCC-INCOMPLETE', 'DDD-INACTIVE'])
      const last = await (await get(`/segments?${viewport}&pageSize=2&page=3`)).json()
      assert.deepEqual(last.data, [])
      assert.equal(last.meta.total, 4)
      const inactive = await (await get(`/segments?${viewport}&status=INACTIVE`)).json()
      assert.deepEqual(inactive.data.map((row) => row.segmentCode), ['DDD-INACTIVE'])
    })
    await t.test('entity-wide search finds cables, segments and assets outside viewport without leaking other entities', async () => {
      const segmentSearch = await get(`/search?entityId=${alpha.entityId}&q=AAA-MAIN`)
      assert.equal(segmentSearch.status, 200)
      const segmentResult = await segmentSearch.json()
      assert.equal(segmentResult.meta.total, 1)
      assert.equal(segmentResult.data[0].properties.segmentCode, 'AAA-MAIN')
      assert.deepEqual(segmentResult.data[0].geometry.coordinates, [[106.8, -6.2], [106.9, -6.2]])

      const assetSearch = await get(`/search?entityId=${alpha.entityId}&q=ODC1`)
      const assetResult = await assetSearch.json()
      assert.equal(assetResult.data.length, 1)
      assert.equal(assetResult.data[0].properties.layer, 'odc')
      assert.equal(assetResult.data[0].properties.name, 'ODC1')
      assert.equal((await get(`/search?entityId=${beta.entityId}&q=B-SECRET`)).status, 403)
      assert.deepEqual((await (await get(`/search?entityId=${alpha.entityId}&q=DRAFT`)).json()).data, [])
      for (const query of [`entityId=${alpha.entityId}&q=x`, `entityId=${alpha.entityId}&q=valid&extra=1`]) assert.equal((await get(`/search?${query}`)).status, 400)
    })
    await t.test('detail exposes full geometry, direction, provenance and distinct pole/ODC/ODP relations', async () => {
      const response = await get(`/segments/${main.id}`)
      assert.equal(response.status, 200)
      const { data } = await response.json()
      assert.equal(data.id, main.id)
      assert.equal(data.ownerEntityId, alpha.entityId)
      assert.equal(data.datasetVersion, 'fixture-v1')
      assert.equal(data.installedCoreCount, 24)
      assert.equal(data.cableType.code, 'FIXTURE_FO')
      assert.equal(data.roadSide, 'LEFT')
      assert.equal(data.nodes.start.id, start.id)
      assert.equal(data.nodes.end.id, end.id)
      assert.deepEqual(data.geometry.coordinates, [[106.8, -6.2], [106.9, -6.2]])
      assert.deepEqual(data.assets.poles.map((pole) => pole.heightM), [7, 9])
      assert.deepEqual(data.assets.odcs.map((asset) => asset.id), [odc.id])
      assert.deepEqual(data.assets.odps.map((asset) => asset.id), [odp.id])
      assert.deepEqual(data.assetCounts, { poles: 2, odcs: 1, odps: 1 })
      assert.equal(data.provenance.externalId, 'stable-external-id')
      assert.equal(data.completeness.status, 'COMPLETE')
      assert.equal('availableCoreCount' in data, false)
    })
    await t.test('burial does not require poles; missing metadata/capacity remains explicit', async () => {
      const buried = (await (await get(`/segments/${burial.id}`)).json()).data
      assert.equal(buried.completeness.status, 'COMPLETE')
      const missing = (await (await get(`/segments/${incomplete.id}`)).json()).data
      assert.equal(missing.installedCoreCount, null)
      assert.equal(missing.capacityValidated, false)
      assert.equal(missing.completeness.status, 'INCOMPLETE')
      assert.ok(missing.completeness.missingFields.includes('validatedCapacity'))
      const aerial = (await (await get(`/segments?${viewport}&status=INACTIVE`)).json()).data[0]
      assert.ok(aerial.completeness.missingFields.includes('poleRelations'))
    })
    await t.test('ODC and ODP map filters are independent and return GeoJSON with layer IDs', async () => {
      for (const [layer, expected] of [['odc', odc], ['odp', odp]]) {
        const response = await get(`/map?${viewport}&layers=${layer}`)
        assert.equal(response.status, 200)
        const { data, meta } = await response.json()
        assert.equal(data.type, 'FeatureCollection')
        assert.equal(meta.total, 1)
        assert.deepEqual(data.features.map((feature) => feature.properties.id), [expected.id])
        assert.equal(data.features[0].properties.layer, layer)
        assert.equal(data.features[0].geometry.type, 'Point')
        assert.equal(data.features[0].properties.datasetVersion, 'fixture-v1')
      }
      const all = await (await get(`/map?${viewport}`)).json()
      assert.equal(all.meta.total, 8)
      assert.deepEqual([...new Set(all.data.features.map((feature) => feature.properties.layer))].sort(), ['odc', 'odp', 'poles', 'segments'])
      const combined = await (await get(`/map?${viewport}&layers=odc,odp,odc`)).json()
      assert.equal(combined.meta.total, 2)
      assert.deepEqual(combined.meta.layers, ['odc', 'odp'])
    })
    await t.test('map pagination remains deterministic across layer combinations', async () => {
      const first = await (await get(`/map?${viewport}&pageSize=3`)).json()
      const second = await (await get(`/map?${viewport}&pageSize=3&page=2`)).json()
      assert.equal(first.data.features.length, 3)
      assert.equal(second.data.features.length, 3)
      assert.equal(first.meta.total, second.meta.total)
      assert.equal(new Set([...first.data.features, ...second.data.features].map((feature) => feature.id)).size, 6)
    })
    await t.test('draft datasets never appear in published list/map or detail', async () => {
      assert.equal((await get(`/segments/${draftSegment.id}`)).status, 404)
      const mapped = await (await get(`/map?${viewport}`)).json()
      assert.equal(mapped.data.features.some((feature) => feature.properties.datasetId === aDraft.id), false)
    })
    await t.test('archived datasets are hidden without deleting their assets', async () => {
      await pool.query("UPDATE network_datasets SET status = 'ARCHIVED' WHERE id = $1", [aDataset.id])
      try {
        assert.equal((await get(`/segments/${main.id}`)).status, 404)
        const mapped = await (await get(`/map?${viewport}`)).json()
        assert.equal(mapped.meta.total, 0)
        const listed = await (await get(`/segments?${viewport}`)).json()
        assert.equal(listed.meta.total, 0)
        assert.ok(Number((await pool.query('SELECT count(*) FROM network_segments WHERE dataset_id = $1', [aDataset.id])).rows[0].count) > 0)
      } finally {
        await pool.query("UPDATE network_datasets SET status = 'PUBLISHED' WHERE id = $1", [aDataset.id])
      }
    })
    await t.test('MultiLineString viewport clipping never turns a segment into a point asset', async () => {
      const multi = await segment('MULTI-EDGE', { geometry: geom('MultiLineString', [
        [[106.81, -6.3], [106.7, -6.4]],
        [[106.82, -6.23], [106.88, -6.23]],
      ]) })
      const mapped = await (await get(`/map?${viewport}&layers=segments`)).json()
      const feature = mapped.data.features.find((item) => item.properties.id === multi.id)
      assert.ok(['LineString', 'MultiLineString'].includes(feature.geometry.type))
      const corner = await segment('CORNER-ONLY', { geometry: geom('LineString', [[106.81, -6.3], [106.7, -6.4]]) })
      const next = await (await get(`/map?${viewport}&layers=segments`)).json()
      assert.equal(next.data.features.some((item) => item.properties.id === corner.id), false)
    })
    await t.test('foreign/nonexistent IDs are indistinguishable; membership alone is not permission', async () => {
      const foreign = await get(`/segments/${bSegment.id}`)
      const absent = await get(`/segments/${randomUUID()}`)
      assert.equal(foreign.status, 404)
      assert.equal(absent.status, 404)
      assert.deepEqual((await foreign.json()).error, (await absent.json()).error)
      assert.equal((await get(`/segments/${main.id}`, bobCookie)).status, 404)
      assert.equal((await get(`/segments?entityId=${beta.entityId}&bbox=106,-7,107,-6`)).status, 403)
      assert.equal((await get(`/map?${viewport}`, unscopedCookie)).status, 403)
      assert.equal((await get(`/map?${viewport}`, bobCookie)).status, 403)
    })
    await t.test('invalid bounds, pagination, IDs and arbitrary filters are rejected', async () => {
      const invalidQueries = [
        `entityId=${alpha.entityId}`, `bbox=106,-7,107,-6`, `${viewport}&pageSize=101`, `${viewport}&page=0`,
        `entityId=${alpha.entityId}&bbox=107,-7,106,-6`, `entityId=${alpha.entityId}&bbox=181,-7,182,-6`,
        `entityId=${alpha.entityId}&bbox=106,NaN,107,-6`, `entityId=${alpha.entityId}&bbox=106,,107,-6`,
        `${viewport}&sort=secret`, `${viewport}&status=UNKNOWN`,
      ]
      for (const query of invalidQueries) assert.equal((await get(`/segments?${query}`)).status, 400, query)
      for (const layer of ['odcOdp', '', 'secret']) assert.equal((await get(`/map?${viewport}&layers=${layer}`)).status, 400)
      assert.equal((await get('/segments/not-a-uuid')).status, 400)
      const empty = await (await get(`/map?entityId=${alpha.entityId}&bbox=0,0,1,1`)).json()
      assert.deepEqual(empty.data.features, [])
      assert.equal(empty.meta.total, 0)
    })
    await t.test('viewport predicate can use the PostGIS GiST index', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SET LOCAL enable_seqscan = off')
        const plan = await client.query('EXPLAIN SELECT id FROM network_segments WHERE ST_Intersects(geometry, ST_MakeEnvelope(106.81,-6.3,106.89,-6.1,4326))')
        assert.match(plan.rows.map((row) => row['QUERY PLAN']).join('\n'), /network_segments_geometry_gist/)
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    })
    await t.test('explicit grants in two entities support scoped detail lookup without conflating permissions', async () => {
      await grants.grant({ ...alphaInput, entityCode: 'BETA', entityName: 'Test Beta' })
      assert.equal((await get(`/segments/${main.id}`)).status, 200)
      assert.equal((await get(`/segments/${bSegment.id}`)).status, 200)
      const betaFeatures = await (await get(`/map?entityId=${beta.entityId}&bbox=106,-7,107,-6`)).json()
      assert.ok(betaFeatures.data.features.length > 0)
      assert.ok(betaFeatures.data.features.every((feature) => feature.properties.ownerEntityId === beta.entityId))
    })
    await t.test('grant revoke immediately blocks every network read path', async () => {
      await grants.revoke({ email: alphaInput.email, entityCode: alphaInput.entityCode, roleCode: alphaInput.roleCode, source: 'integration-test' })
      assert.equal((await get(`/map?${viewport}`)).status, 403)
      assert.equal((await get(`/segments?${viewport}`)).status, 403)
      assert.equal((await get(`/segments/${main.id}`)).status, 404)
    })
  } finally {
    if (app) await app.close()
    if (pool) await pool.end()
    if (originalUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalUrl
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`)
    await admin.end()
    if (baselineFolder) await rm(baselineFolder, { recursive: true, force: true })
  }
})
