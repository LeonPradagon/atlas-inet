import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { Pool, Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { AppModule } from '../dist/app.module.js'
import { loadEnvironment } from '../dist/config/load-env.js'
import { loadAppConfig } from '../dist/config/app-config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { AuthService } from '../dist/modules/auth/auth.service.js'
import { createAuth } from '../dist/modules/auth/auth.js'
import { AccessProvisioner, accessGrantInput } from '../dist/modules/access/access-provisioner.js'
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js'
import * as schema from '../dist/database/schema/index.js'

test('access domain: database constraints, provisioning and authenticated HTTP isolation', async (t) => {
  loadEnvironment()
  const config = loadAppConfig()
  const originalUrl = process.env.DATABASE_URL
  const originalNodeEnv = process.env.NODE_ENV
  const databaseName = `atlas_access_test_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: config.databaseUrl })
  const databaseUrl = new URL(config.databaseUrl)
  databaseUrl.pathname = `/${databaseName}`
  let pool
  let app
  let created = false
  let baselineFolder
  await admin.connect()
  try {
    // Only this uniquely named disposable database is populated or removed.
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    pool = new Pool({ connectionString: databaseUrl.toString(), max: 3 })
    const db = drizzle(pool, { schema })
    const tempRoot = join(homedir(), 'AppData', 'Local', 'Temp', 'opencode')
    await mkdir(tempRoot, { recursive: true })
    baselineFolder = await mkdtemp(join(tempRoot, 'atlas-access-baseline-'))
    await mkdir(join(baselineFolder, 'meta'))
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'))
    await writeFile(join(baselineFolder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }))
    await copyFile('drizzle/0000_auth-and-postgis.sql', join(baselineFolder, '0000_auth-and-postgis.sql'))
    await migrate(db, { migrationsFolder: baselineFolder })
    const auth = createAuth(db, { ...config, databaseUrl: databaseUrl.toString(), nodeEnv: 'test' }, true)
    const password = `Test-only-${randomUUID()}`
    const alice = await auth.api.signUpEmail({ body: { email: 'alice@example.test', name: 'Alice', password } })
    const bob = await auth.api.signUpEmail({ body: { email: 'bob@example.test', name: 'Bob', password } })
    await auth.api.signUpEmail({ body: { email: 'unscoped@example.test', name: 'Admin', password } })
    // Apply the new access migration to an existing auth database with accounts/sessions.
    await migrate(db, { migrationsFolder: 'drizzle' })
    const grant = new AccessProvisioner(db)
    const alphaInput = { email: 'alice@example.test', entityCode: 'ALPHA', entityName: 'Test Alpha', roleCode: 'reader', permissions: ['entities.read'], source: 'integration-test' }
    const betaInput = { ...alphaInput, email: 'bob@example.test', entityCode: 'BETA', entityName: 'Test Beta' }
    const alpha = await grant.grant(alphaInput)
    const beta = await grant.grant(betaInput)

    await t.test('migration preserves existing auth data and can run again', async () => {
      await migrate(db, { migrationsFolder: 'drizzle' })
      assert.equal(Number((await pool.query('SELECT count(*) FROM "user"')).rows[0].count), 3)
    })
    await t.test('grant replay is idempotent and does not duplicate audit', async () => {
      assert.equal((await grant.grant(alphaInput)).changed, false)
      assert.equal(Number((await pool.query('SELECT count(*) FROM access_audit')).rows[0].count), 2)
      assert.equal(Number((await pool.query('SELECT count(*) FROM membership_roles')).rows[0].count), 2)
    })
    await t.test('concurrent grants produce one grant and one audit event', async () => {
      const input = { ...alphaInput, roleCode: 'network-reader', permissions: ['network.read'] }
      const results = await Promise.all([grant.grant(input), grant.grant(input)])
      assert.equal(results.filter((result) => result.changed).length, 1)
    })
    await t.test('existing role permissions are not silently changed', async () => {
      await assert.rejects(grant.grant({ ...alphaInput, permissions: ['entities.write'] }), /different permissions/)
      assert.equal(Number((await pool.query('SELECT count(*) FROM permissions WHERE code = $1', ['entities.write'])).rows[0].count), 0)
    })
    await t.test('wildcard permission is rejected', () => {
      assert.equal(accessGrantInput.safeParse({ ...alphaInput, permissions: ['*'] }).success, false)
    })
    await t.test('database prevents cross-entity role assignment', async () => {
      await assert.rejects(pool.query('INSERT INTO membership_roles (membership_id, role_id, entity_id) VALUES ($1,$2,$3)', [alpha.membershipId, beta.roleId, alpha.entityId]), { code: '23503' })
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
    const get = (path, sessionCookie) => fetch(`${origin}/api/v1${path}`, { headers: sessionCookie ? { Cookie: sessionCookie } : {} })

    await t.test('anonymous requests fail closed', async () => {
      for (const path of ['/me', '/entities', `/entities/${alpha.entityId}`]) assert.equal((await get(path)).status, 401)
    })
    await t.test('/me reports grants per entity, preserving existing response fields', async () => {
      const response = await get('/me', aliceCookie)
      assert.equal(response.status, 200)
      const { data } = await response.json()
      assert.equal(data.user.id, alice.user.id)
      assert.deepEqual(data.entities, [alpha.entityId])
      assert.deepEqual(data.permissions, ['entities.read', 'network.read'])
      assert.deepEqual(data.entityAccess[0].permissions, ['entities.read', 'network.read'])
      assert.deepEqual(data.entityAccess[0].roles, ['network-reader', 'reader'])
    })
    await t.test('list returns only the authorized entity, not other tenants', async () => {
      const { data } = await (await get('/entities', aliceCookie)).json()
      assert.deepEqual(data.map((item) => item.id), [alpha.entityId])
      assert.equal((await get(`/entities/${alpha.entityId}`, aliceCookie)).status, 200)
      assert.equal((await get(`/entities/${beta.entityId}`, aliceCookie)).status, 403)
      assert.equal((await get(`/entities/${alpha.entityId}`, bobCookie)).status, 403)
      assert.equal((await get(`/entities/${randomUUID()}`, aliceCookie)).status, 403)
    })
    await t.test('display name Admin does not imply permissions', async () => {
      const { data } = await (await get('/me', unscopedCookie)).json()
      assert.deepEqual(data.entities, [])
      assert.deepEqual(data.permissions, [])
      assert.deepEqual((await (await get('/entities', unscopedCookie)).json()).data, [])
      assert.equal((await get(`/entities/${alpha.entityId}`, unscopedCookie)).status, 403)
    })
    await t.test('malformed entity ID is rejected', async () => {
      assert.equal((await get('/entities/not-a-uuid', aliceCookie)).status, 400)
    })
    await t.test('pagination is bounded and cannot be used to bypass entity scope', async () => {
      const { data, meta } = await (await get('/entities?page=2&pageSize=1', aliceCookie)).json()
      assert.deepEqual(data, [])
      assert.deepEqual(meta, { page: 2, pageSize: 1, total: 1 })
      for (const path of ['/entities?pageSize=101', '/entities?page=0', '/entities?entityId=anything', '/entities?sort=password']) {
        assert.equal((await get(path, aliceCookie)).status, 400)
      }
    })
    await t.test('a permission in one entity cannot authorize another membership', async () => {
      await grant.grant({ ...betaInput, email: alphaInput.email, roleCode: 'network-reader', permissions: ['network.read'] })
      const { data } = await (await get('/me', aliceCookie)).json()
      assert.ok(data.permissions.includes('entities.read'))
      assert.ok(data.entities.includes(beta.entityId))
      assert.deepEqual(data.entityAccess.find((entity) => entity.id === beta.entityId).permissions, ['network.read'])
      assert.equal((await get(`/entities/${beta.entityId}`, aliceCookie)).status, 403)
      assert.deepEqual((await (await get('/entities', aliceCookie)).json()).data.map((entity) => entity.id), [alpha.entityId])
    })
    for (const [table, column, id] of [['roles', 'id', alpha.roleId], ['memberships', 'id', alpha.membershipId], ['entities', 'id', alpha.entityId]]) {
      await t.test(`inactive ${table} revoke permission immediately`, async () => {
        await pool.query(`UPDATE ${table} SET active = false WHERE ${column} = $1`, [id])
        try {
          assert.equal((await get(`/entities/${alpha.entityId}`, aliceCookie)).status, 403)
        } finally {
          await pool.query(`UPDATE ${table} SET active = true WHERE ${column} = $1`, [id])
        }
      })
    }
    await t.test('revoke is immediate, audited and idempotent without deleting the account', async () => {
      const input = { email: alphaInput.email, entityCode: alphaInput.entityCode, roleCode: alphaInput.roleCode, source: 'integration-test' }
      assert.equal((await grant.revoke(input)).changed, true)
      assert.equal((await get(`/entities/${alpha.entityId}`, aliceCookie)).status, 403)
      assert.equal((await grant.revoke(input)).changed, false)
      assert.equal(Number((await pool.query("SELECT count(*) FROM access_audit WHERE action = 'ROLE_REVOKED'")).rows[0].count), 1)
      assert.equal((await get('/me', aliceCookie)).status, 200)
      assert.equal((await get(`/entities/${beta.entityId}`, bobCookie)).status, 200)
    })
    await t.test('expired sessions cannot access entity data', async () => {
      await pool.query('UPDATE session SET expires_at = now() - interval \'1 second\' WHERE user_id = $1', [bob.user.id])
      assert.equal((await get('/entities', bobCookie)).status, 401)
    })
    await t.test('new access relations preserve account deletion and retain access audit', async () => {
      await pool.query('DELETE FROM "user" WHERE id = $1', [bob.user.id])
      assert.equal(Number((await pool.query('SELECT count(*) FROM memberships WHERE user_id = $1', [bob.user.id])).rows[0].count), 0)
      assert.equal(Number((await pool.query('SELECT count(*) FROM membership_roles WHERE membership_id = $1', [beta.membershipId])).rows[0].count), 0)
      assert.equal(Number((await pool.query('SELECT count(*) FROM access_audit WHERE subject_user_id = $1', [bob.user.id])).rows[0].count), 1)
    })
    await app.get(DatabaseService).checkReady()
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
