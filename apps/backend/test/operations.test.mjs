import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { access as fileAccess, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { Client, Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { AppModule } from '../dist/app.module.js'
import { WorkerModule } from '../dist/worker.module.js'
import { loadEnvironment } from '../dist/config/load-env.js'
import { loadAppConfig } from '../dist/config/app-config.js'
import { AuthService } from '../dist/modules/auth/auth.service.js'
import { createAuth } from '../dist/modules/auth/auth.js'
import { AccessProvisioner } from '../dist/modules/access/access-provisioner.js'
import { JobRunnerService } from '../dist/modules/jobs/job-runner.service.js'
import { InternalAdapters } from '../dist/modules/analysis/internal-adapters.js'
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js'
import { spreadsheet } from '../dist/modules/files/tabular-files.js'
import * as schema from '../dist/database/schema/index.js'

test('Phase 2 operations: atomic capacity, imports, analysis, durable worker and exports', async (t) => {
  loadEnvironment()
  const config = loadAppConfig()
  const original = { DATABASE_URL:process.env.DATABASE_URL,NODE_ENV:process.env.NODE_ENV,WORKER_INTERVAL_MS:process.env.WORKER_INTERVAL_MS,GEOCODING_INTERNAL_URL:process.env.GEOCODING_INTERNAL_URL,PHOTON_INTERNAL_URL:process.env.PHOTON_INTERNAL_URL,ROUTING_INTERNAL_URL:process.env.ROUTING_INTERNAL_URL }
  const name = `atlas_ops_test_${randomUUID().replaceAll('-','')}`
  const url = new URL(config.databaseUrl)
  url.pathname=`/${name}`
  const admin = new Client({ connectionString:config.databaseUrl })
  let pool,app,worker,created=false,legacyFolder
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    created=true
    pool=new Pool({ connectionString:url.toString(),max:6 })
    const db=drizzle(pool,{ schema })
    const tempRoot=await fileAccess(join(tmpdir(),'opencode')).then(() => join(tmpdir(),'opencode')).catch(() => tmpdir())
    legacyFolder=await mkdtemp(join(tempRoot,'atlas_policy_migration_'))
    await mkdir(join(legacyFolder,'meta'))
    const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'))
    const legacyEntries=journal.entries.filter((entry) => entry.idx<=3)
    await writeFile(join(legacyFolder,'meta','_journal.json'),JSON.stringify({ ...journal,entries:legacyEntries }))
    for (const entry of legacyEntries) await copyFile(`drizzle/${entry.tag}.sql`,join(legacyFolder,`${entry.tag}.sql`))
    await migrate(db,{ migrationsFolder:legacyFolder })
    const auth=createAuth(db,{ ...config,databaseUrl:url.toString(),nodeEnv:'test' },true)
    const password=`Test-only-${randomUUID()}`
    const alice=await auth.api.signUpEmail({ body:{ email:'alice@example.test',name:'Alice',password } })
    await auth.api.signUpEmail({ body:{ email:'bob@example.test',name:'Bob',password } })
    const grants=new AccessProvisioner(db)
    const permissionList=['network.read','network.write','network.master-write','bookings.create','bookings.read','bookings.release','allocations.write','waiting-list.create','waiting-list.read','waiting-list.allocate','waiting-list.cancel','settings.read','settings.write','settings.approve-operational','settings.approve-engineering','notifications.read','notifications.receive','analysis.create','analysis.bulk','analysis.read','imports.write','reports.read','reports.export','audit.read']
    const alpha=await grants.grant({ email:'alice@example.test',entityCode:'ALPHA',entityName:'Test Alpha',roleCode:'ops',permissions:permissionList,source:'integration-test' })
    const beta=await grants.grant({ email:'bob@example.test',entityCode:'BETA',entityName:'Test Beta',roleCode:'ops',permissions:permissionList,source:'integration-test' })
    await grants.grant({ email:'bob@example.test',entityCode:'ALPHA',entityName:'Test Alpha',roleCode:'reviewer-operational',permissions:['settings.read','settings.approve-operational','notifications.read'],source:'integration-test' })
    const legacySetting=(await pool.query('INSERT INTO settings(entity_id,key,version,value,updated_by) VALUES($1,$2,1,$3,$4) RETURNING id',[beta.entityId,'booking-policy',JSON.stringify({ duration:3,unit:'MONTH' }),alice.user.id])).rows[0]
    const preserved=await pool.query('SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM memberships) AS memberships,(SELECT count(*) FROM membership_roles) AS grants')
    await migrate(db,{ migrationsFolder:'drizzle' })
    const [dataset]=await db.insert(schema.networkDatasets).values({ ownerEntityId:alpha.entityId,version:'fixture-v1',sourceSystem:'fixture',status:'PUBLISHED',publishedAt:new Date(),createdBy:alice.user.id }).returning()
    async function segment(code,total=4,extra={}) {
      return (await db.insert(schema.networkSegments).values({ ownerEntityId:alpha.entityId,datasetId:dataset.id,segmentCode:code,cableName:`Fixture ${code}`,installedCoreCount:total,capacityValidated:total!==null,sourceSystem:'fixture',externalId:code,createdBy:alice.user.id,geometry:sql`ST_GeomFromText('LINESTRING(106.8 -6.2,106.9 -6.2)',4326)`,...extra }).returning())[0]
    }
    const main=await segment('MAIN')
    const unknown=await segment('UNKNOWN',null)
    process.env.DATABASE_URL=url.toString()
    process.env.NODE_ENV='test'
    process.env.WORKER_INTERVAL_MS='10'
    delete process.env.GEOCODING_INTERNAL_URL
    delete process.env.PHOTON_INTERNAL_URL
    delete process.env.ROUTING_INTERNAL_URL
    app=await NestFactory.create(AppModule,{ logger:false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.listen(0,'127.0.0.1')
    worker=await NestFactory.createApplicationContext(WorkerModule,{ logger:false })
    const runner=worker.get(JobRunnerService)
    const origin=await app.getUrl()
    async function cookie(email) {
      const response=await app.get(AuthService).instance.api.signInEmail({ body:{ email,password },asResponse:true })
      return response.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ')
    }
    const aCookie=await cookie('alice@example.test'),bCookie=await cookie('bob@example.test')
    const request=(path,method='GET',body,headers={},session=aCookie) => fetch(`${origin}/api/v1/${path}`,{ method,headers:{ ...(session ? { Cookie:session } : {}),...(body && !(body instanceof FormData) ? { 'Content-Type':'application/json' } : {}),...headers },body:body ? body instanceof FormData ? body : JSON.stringify(body) : undefined })
    async function data(response,status=200) { const json=await response.json();assert.equal(response.status,status,JSON.stringify(json));return json.data }
    const customer=(segmentId,coreCount=3) => ({ segmentId,coreCount,customerName:'Test customer',customerPicName:'Test PIC',customerPicContact:'test@example.test',presalesUserId:alice.user.id,reason:'Fixture only' })
    const book=(id,cores,key=randomUUID()) => request('bookings','POST',customer(id,cores),{ 'Idempotency-Key':key })
    const usage=async (id) => data(await request(`network/segments/${id}/capacity`))
    const propose=(key,value,version=0,reason='Synthetic fixture proposal',submissionKey=randomUUID()) => request(`settings/${key}/requests?entityId=${alpha.entityId}`,'POST',{ value,reason },{ 'If-Match':String(version),'Idempotency-Key':submissionKey })
    async function changePolicy(key,value,version=0) {
      if (key==='analysis-policy') await grants.grant({ email:'bob@example.test',entityCode:'ALPHA',entityName:'Test Alpha',roleCode:'reviewer-engineering',permissions:['settings.read','settings.approve-engineering','notifications.read'],source:'integration-test' })
      const proposal=await data(await propose(key,value,version),202)
      return data(await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Independent fixture review' },{},bCookie),201)
    }
    const upload=async (path,fileName,buffer,fields={}) => {
      const form=new FormData()
      for (const [key,value] of Object.entries(fields)) form.set(key,String(value))
      form.set('file',new Blob([buffer],{ type:fileName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.google-earth.kml+xml' }),fileName)
      return request(path,'POST',form)
    }

    await t.test('new migration is repeatable and seeds no operational data',async () => {
      await migrate(db,{ migrationsFolder:'drizzle' })
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n,0)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n,2)
      assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM memberships) AS memberships,(SELECT count(*) FROM membership_roles) AS grants')).rows,preserved.rows)
      const existing=await data(await request(`settings/booking-policy?entityId=${beta.entityId}`,'GET',undefined,{},bCookie))
      assert.equal(existing.id,legacySetting.id);assert.equal(existing.version,1);assert.deepEqual(existing.value,{ duration:3,unit:'MONTH' });assert.equal(existing.changeRequestId,null)
    })
    await t.test('all mutation/read surfaces require a session; foreign entity cannot operate',async () => {
      for (const [path,method,body] of [['bookings','POST',customer(main.id)],['analysis','POST',{ entityId:alpha.entityId,latitude:-6.2,longitude:106.85 }],[`settings/booking-policy?entityId=${alpha.entityId}`,'GET'],[`reports/utilization?entityId=${alpha.entityId}`,'GET'],[`notifications?entityId=${alpha.entityId}`,'GET']]) assert.equal((await request(path,method,body,{},'')).status,401)
      assert.equal((await request('bookings','POST',customer(main.id),{ 'Idempotency-Key':randomUUID() },bCookie)).status,404)
      assert.equal((await request(`reports/utilization?entityId=${beta.entityId}`)).status,403)
    })
    await t.test('unknown capacity remains null and blocks booking',async () => {
      const result=await usage(unknown.id)
      assert.equal(result.total,null);assert.equal(result.available,null)
      assert.equal((await book(unknown.id,1)).status,422)
    })
    await t.test('policy requests stay pending, require reasons and replay without creating duplicate audit/outbox',async () => {
      const value={ duration:5,unit:'DAY' },key=randomUUID()
      const proposal=await data(await propose('booking-policy',value,0,'Fixture change reason',key),202)
      const replay=await data(await propose('booking-policy',value,0,'Fixture change reason',key),202)
      assert.equal(proposal.id,replay.id);assert.equal(proposal.status,'PENDING')
      const active=await data(await request(`settings/booking-policy?entityId=${alpha.entityId}`))
      assert.equal(active.version,0);assert.deepEqual(active.value,{ duration:1,unit:'MONTH' })
      assert.equal((await propose('booking-policy',{ duration:6,unit:'DAY' },0,'Fixture change reason',key)).status,409)
      assert.equal((await propose('booking-policy',value,0,'')).status,400)
      assert.equal((await request(`settings/booking-policy/requests?entityId=${alpha.entityId}`,'POST',{ value,reason:'test' },{ 'If-Match':'0' })).status,400)
      assert.equal((await request(`settings/requests?entityId=${beta.entityId}`)).status,403)
      assert.equal((await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Attempt own approval' })).status,403)
      assert.equal((await request(`settings/requests/${proposal.id}/reject`,'POST',{ reason:'Attempt own rejection' })).status,403)
      assert.equal((await request(`settings/requests/${randomUUID()}/approve`,'POST',{ reason:'Missing' },{},bCookie)).status,404)
      const rejected=await data(await request(`settings/requests/${proposal.id}/reject`,'POST',{ reason:'Independent rejection' },{},bCookie),201)
      assert.equal(rejected.status,'REJECTED');assert.equal(rejected.approvedVersion,null)
      await data(await request(`settings/requests/${proposal.id}/reject`,'POST',{ reason:'Independent rejection' },{},bCookie),201)
      assert.equal((await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Cannot reverse rejection' },{},bCookie)).status,409)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='POLICY_CHANGE_REJECTED'",[proposal.id])).rows[0].n,1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE payload->>'resourceId'=$1 AND type='POLICY_CHANGE_REQUESTED'",[proposal.id])).rows[0].n,1)
      const listResponse=await request(`settings/requests?entityId=${alpha.entityId}&pageSize=1`)
      const list=await listResponse.json();assert.equal(listResponse.status,200);assert.equal(list.data.length,1)
      assert.deepEqual(list.data[0].baseValue,{ duration:1,unit:'MONTH' })
    })
    await t.test('engineering approval cannot be replaced by an operational reviewer; requester may cancel',async () => {
      const value={ radiusM:6000,formulaApproved:false,slackPercent:null,extraLengthM:null,maxDetourPercent:null }
      const proposal=await data(await propose('analysis-policy',value),202)
      assert.equal((await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Wrong approval type' },{},bCookie)).status,403)
      assert.equal((await request(`settings/requests/${proposal.id}/reject`,'POST',{ reason:'Wrong approval type' },{},bCookie)).status,403)
      assert.equal((await request(`settings/requests/${proposal.id}/cancel`,'POST',{ reason:'Not the owner' },{},bCookie)).status,403)
      await assert.rejects(pool.query("UPDATE policy_change_requests SET status='APPROVED',decided_by=requested_by,decided_at=clock_timestamp(),decision_reason='self',approved_version=base_version+1 WHERE id=$1",[proposal.id]),{ code:'23514' })
      const cancelled=await data(await request(`settings/requests/${proposal.id}/cancel`,'POST',{ reason:'Withdraw fixture proposal' }),201)
      assert.equal(cancelled.status,'CANCELLED')
      await data(await request(`settings/requests/${proposal.id}/cancel`,'POST',{ reason:'Withdraw fixture proposal' }),201)
      assert.equal((await data(await request(`settings/analysis-policy?entityId=${alpha.entityId}`))).version,0)
    })
    await t.test('legacy direct writes cannot bypass approval; proposal values and terminal history are immutable',async () => {
      assert.equal((await request(`settings/booking-policy?entityId=${alpha.entityId}`,'PATCH',{ duration:9,unit:'DAY' },{ 'If-Match':'0' })).status,409)
      await assert.rejects(pool.query('INSERT INTO settings(entity_id,key,version,value,updated_by) VALUES($1,$2,1,$3,$4)',[alpha.entityId,'booking-policy',JSON.stringify({ duration:9,unit:'DAY' }),alice.user.id]),{ code:'23514' })
      const proposal=await data(await propose('booking-policy',{ duration:9,unit:'DAY' }),202)
      await assert.rejects(pool.query("UPDATE policy_change_requests SET proposed_value='{}'::jsonb WHERE id=$1",[proposal.id]),{ code:'23514' })
      await data(await request(`settings/requests/${proposal.id}/cancel`,'POST',{ reason:'End immutable fixture' }),201)
      await assert.rejects(pool.query("UPDATE policy_change_requests SET decision_reason='rewrite history' WHERE id=$1",[proposal.id]),{ code:'23514' })
      await assert.rejects(pool.query('DELETE FROM settings WHERE id=$1',[legacySetting.id]),{ code:'23514' })
    })
    let booking
    await t.test('monitoring summary covers entire entity, including unknown capacity and empty scopes',async () => {
      const response=await request(`reports/utilization?entityId=${alpha.entityId}&pageSize=1`)
      const json=await response.json();assert.equal(response.status,200)
      assert.equal(json.data.length,1);assert.equal(json.meta.total,2)
      assert.deepEqual(json.meta.summary,{ segmentCount:2,unknownCapacityCount:1,total:null,used:0,booked:0,idle:null,available:null,waitingCount:0,waitingCores:0 })
      const empty=await request(`reports/utilization?entityId=${beta.entityId}`, 'GET',undefined,{},bCookie)
      const emptyJson=await empty.json();assert.equal(empty.status,200)
      assert.deepEqual(emptyJson.meta.summary,{ segmentCount:0,unknownCapacityCount:0,total:0,used:0,booked:0,idle:0,available:0,waitingCount:0,waitingCores:0 })
      try {
        await pool.query('UPDATE network_segments SET installed_core_count=2,capacity_validated=true WHERE id=$1',[unknown.id])
        const known=await request(`reports/utilization?entityId=${alpha.entityId}&pageSize=1&page=2`)
        const knownJson=await known.json();assert.equal(known.status,200)
        assert.equal(knownJson.data.length,1)
        assert.deepEqual(knownJson.meta.summary,{ segmentCount:2,unknownCapacityCount:0,total:6,used:0,booked:0,idle:6,available:6,waitingCount:0,waitingCores:0 })
      } finally { await pool.query('UPDATE network_segments SET installed_core_count=NULL,capacity_validated=false WHERE id=$1',[unknown.id]) }
    })
    await t.test('concurrent 3-core bookings on total 4 cannot overbook',async () => {
      const responses=await Promise.all([book(main.id,3),book(main.id,3)])
      assert.deepEqual(responses.map((r) => r.status).sort(),[201,409])
      booking=await data(responses.find((r) => r.status===201),201)
      assert.deepEqual(Object.fromEntries(Object.entries(await usage(main.id)).filter(([key]) => ['total','used','booked','idle','available'].includes(key))),{ total:4,used:0,booked:3,idle:4,available:1 })
      assert.equal((await request(`network/segments/${main.id}`,'PATCH',{ installedCoreCount:2 },{ 'If-Match':'1' })).status,409)
    })
    await t.test('idempotency serializes parallel replay and rejects changed payload',async () => {
      const s=await segment('IDEMPOTENT',10),key=randomUUID()
      const responses=await Promise.all([book(s.id,2,key),book(s.id,2,key)])
      const records=await Promise.all(responses.map((r) => data(r,201)))
      assert.equal(records[0].id,records[1].id)
      assert.equal((await usage(s.id)).booked,2)
      assert.equal((await book(s.id,3,key)).status,409)
      assert.equal((await request('bookings','POST',customer(s.id))).status,400)
    })
    await t.test('calendar expiry clamps month-end in Jakarta; settings only affect new bookings',async () => {
      const result=await pool.query("SELECT ((TIMESTAMPTZ '2028-01-31 10:00:00+07' AT TIME ZONE 'Asia/Jakarta') + make_interval(months => 1)) AT TIME ZONE 'Asia/Jakarta' AS expiry")
      assert.equal(result.rows[0].expiry.toISOString(),'2028-02-29T03:00:00.000Z')
      const before=(await pool.query('SELECT expires_at FROM bookings WHERE id=$1',[booking.id])).rows[0].expires_at
      await changePolicy('booking-policy',{ duration:2,unit:'DAY' })
      assert.equal((await request(`settings/booking-policy?entityId=${alpha.entityId}`,'PATCH',{ duration:3,unit:'DAY' },{ 'If-Match':'0' })).status,409)
      const s=await segment('POLICY',10),newBooking=await data(await book(s.id,1),201)
      assert.equal(newBooking.policyVersion,1)
      assert.ok(Math.abs(new Date(newBooking.expiresAt)-new Date(newBooking.createdAt)-2*86400_000)<10)
      assert.equal((await pool.query('SELECT expires_at FROM bookings WHERE id=$1',[booking.id])).rows[0].expires_at.toISOString(),before.toISOString())
      const saved=await data(await request(`settings/booking-policy?entityId=${alpha.entityId}`))
      assert.ok(saved.changeRequestId)
      const decided=await data(await request(`settings/requests/${saved.changeRequestId}/approve`,'POST',{ reason:'Independent fixture review' },{},bCookie),201)
      assert.equal(decided.approvedVersion,1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM settings WHERE entity_id=$1 AND key='booking-policy'",[alpha.entityId])).rows[0].n,1)
    })
    await t.test('FIFO rejects bypass and partial promotion; release promotes only manually',async () => {
      const head=await data(await request('waiting-list','POST',customer(main.id,4),{ 'Idempotency-Key':randomUUID() }),201)
      const tail=await data(await request('waiting-list','POST',customer(main.id,1),{ 'Idempotency-Key':randomUUID() }),201)
      assert.equal((await book(main.id,1)).status,409)
      assert.equal((await request(`waiting-list/${tail.id}/allocate`,'POST',undefined,{ 'Idempotency-Key':randomUUID() })).status,409)
      assert.equal((await request(`waiting-list/${head.id}/allocate`,'POST',undefined,{ 'Idempotency-Key':randomUUID() })).status,409)
      await data(await request(`bookings/${booking.id}/release`,'POST',{ reason:'Cancelled test need' }),201)
      await data(await request(`bookings/${booking.id}/release`,'POST',{ reason:'Retry' }),201)
      assert.equal((await usage(main.id)).booked,0)
      assert.equal((await usage(main.id)).waitingCount,2)
      const key=randomUUID()
      const promoted=await data(await request(`waiting-list/${head.id}/allocate`,'POST',undefined,{ 'Idempotency-Key':key }),201)
      const replay=await data(await request(`waiting-list/${head.id}/allocate`,'POST',undefined,{ 'Idempotency-Key':key }),201)
      assert.equal(promoted.id,replay.id)
      assert.equal((await usage(main.id)).booked,4)
      await data(await request(`waiting-list/${tail.id}/cancel`,'POST',{ reason:'Test end' }),201)
    })
    await t.test('Booked → Used transfer and deallocation do not double-count core',async () => {
      const s=await segment('ACTIVATE',5),b=await data(await book(s.id,3),201)
      const allocation=await data(await request(`bookings/${b.id}/activate`,'POST',{ operationalReference:'TEST-ACTIVE' }),201)
      assert.equal((await usage(s.id)).used,3);assert.equal((await usage(s.id)).booked,0)
      const same=await data(await request(`bookings/${b.id}/activate`,'POST',{ operationalReference:'TEST-ACTIVE' }),201)
      assert.equal(same.id,allocation.id)
      assert.equal((await request(`bookings/${b.id}/activate`,'POST',{ operationalReference:'DIFFERENT' })).status,409)
      await data(await request(`allocations/${allocation.id}/deallocate`,'POST',{ reason:'Test end' }),201)
      await data(await request(`allocations/${allocation.id}/deallocate`,'POST',{ reason:'Retry' }),201)
      assert.equal((await usage(s.id)).available,5)
    })
    await t.test('expired booking cannot activate before worker; expiry/outbox remain idempotent',async () => {
      const s=await segment('EXPIRY',5),b=await data(await book(s.id,3),201)
      await pool.query("UPDATE bookings SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[b.id])
      assert.equal((await usage(s.id)).available,5)
      assert.equal((await request(`bookings/${b.id}/activate`,'POST',{ operationalReference:'EXPIRED' })).status,409)
      await runner.tick();await runner.tick()
      assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[b.id])).rows[0].status,'EXPIRED')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE type='BOOKING_EXPIRED' AND payload->>'resourceId'=$1",[b.id])).rows[0].n,1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE type='BOOKING_EXPIRED' AND payload->>'resourceId'=$1",[b.id])).rows[0].n,1)
      const notifications=await data(await request(`notifications?entityId=${alpha.entityId}`))
      const notification=notifications.find((n) => n.payload.resourceId===b.id)
      assert.ok(notification)
      const unreadBefore=await data(await request(`notifications/unread-count?entityId=${alpha.entityId}`))
      assert.ok(unreadBefore >= 1)
      assert.equal((await request(`notifications/${notification.id}/read`,'POST',undefined,{},bCookie)).status,404)
      await data(await request(`notifications/${notification.id}/read`,'POST'),201)
      assert.equal(await data(await request(`notifications/unread-count?entityId=${alpha.entityId}`)),unreadBefore-1)
    })
    await t.test('nearest uses full canonical line geography; absent dependencies remain explicit',async () => {
      const result=await data(await request('analysis','POST',{ entityId:alpha.entityId,latitude:-6.201,longitude:106.85 }))
      assert.equal(result.status,'OK')
      assert.ok(result.nearestNetworkDistanceM>100 && result.nearestNetworkDistanceM<130)
      assert.equal(result.estimatedCableLengthM,null)
      assert.equal(result.needsSurvey,true)
      const absent=await data(await request('analysis','POST',{ entityId:alpha.entityId,latitude:0,longitude:0 }))
      assert.equal(absent.status,'NO_NETWORK_IN_RADIUS');assert.equal(absent.nearestNetworkDistanceM,null)
      const address=await data(await request('analysis','POST',{ entityId:alpha.entityId,address:'Test address' }))
      assert.equal(address.status,'GEOCODING_NOT_CONFIGURED')
      assert.equal((await request('analysis','POST',{ entityId:alpha.entityId,latitude:1 })).status,400)
      const client=await pool.connect()
      try {
        await client.query('BEGIN');await client.query('SET LOCAL enable_seqscan=off')
        const plan=await client.query("EXPLAIN SELECT id FROM network_segments WHERE ST_DWithin(geometry::geography,ST_GeomFromText('POINT(106.85 -6.201)',4326)::geography,5000)")
        assert.match(plan.rows.map((r) => r['QUERY PLAN']).join('\n'),/network_segments_geography_gist/)
      } finally { await client.query('ROLLBACK');client.release() }
    })
    const kml=(name='TEST-IMPORT',coords='106.8,-6.2 106.9,-6.2') => Buffer.from(`<kml><Document><Placemark id="stable-import"><name>${name}</name><ExtendedData><Data name="code"><value>IMPORTED</value></Data></ExtendedData><LineString><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`)
    const fields={ entityId:alpha.entityId,sourceSystem:'kml-test' }
    let imported
    await t.test('KML stages without fake capacity; publish requires approved naming; replay keeps stable IDs',async () => {
      const preview=await data(await upload('imports','network.kml',kml(),fields),201)
      assert.equal(preview.rows[0].installedCoreCount,undefined)
      assert.equal((await request(`imports/${preview.id}/publish`,'POST',{ version:'kml-v1' })).status,422)
      await changePolicy('naming-policy',{ approved:true,pattern:'[A-Za-z0-9 _-]+',uniquePerEntity:true })
      const publish=await data(await request(`imports/${preview.id}/publish`,'POST',{ version:'kml-v1' }),201)
      const replay=await data(await request(`imports/${preview.id}/publish`,'POST',{ version:'kml-v1' }),201)
      assert.equal(publish.datasetId,replay.datasetId)
      imported=(await pool.query("SELECT * FROM network_segments WHERE external_id='stable-import'")).rows[0]
      assert.equal(imported.installed_core_count,null)
      assert.equal((await usage(imported.id)).available,null)
      const updated=await data(await upload('imports','network.kml',kml('TEST-RENAMED'),{ ...fields,mappings:JSON.stringify({ '1':{ installedCoreCount:8,capacityValidated:true } }) }),201)
      await data(await request(`imports/${updated.id}/publish`,'POST',{ version:'kml-v2' }),201)
      const after=(await pool.query("SELECT * FROM network_segments WHERE external_id='stable-import'")).rows[0]
      assert.equal(after.id,imported.id)
      assert.equal(after.cable_name,'TEST-RENAMED')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM cable_name_history WHERE segment_id=$1',[imported.id])).rows[0].n,1)
    })
    await t.test('publish rollback preserves active bookings; stale preview cannot overwrite newer data',async () => {
      const b=await data(await book(imported.id,6),201)
      const unsafe=await data(await upload('imports','network.kml',kml('TEST-RENAMED'),{ ...fields,mappings:JSON.stringify({ '1':{ installedCoreCount:4,capacityValidated:true } }) }),201)
      assert.equal((await request(`imports/${unsafe.id}/publish`,'POST',{ version:'unsafe-v3' })).status,409)
      assert.equal((await usage(imported.id)).total,8);assert.equal((await usage(imported.id)).booked,6)
      const current=(await pool.query('SELECT version FROM network_segments WHERE id=$1',[imported.id])).rows[0].version
      await data(await request(`network/segments/${imported.id}`,'PATCH',{ installedCoreCount:10 },{ 'If-Match':String(current) }))
      assert.equal((await request(`imports/${unsafe.id}/publish`,'POST',{ version:'unsafe-v3' })).status,409)
      assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[b.id])).rows[0].status,'BOOKED')
    })
    await t.test('unsafe KML, invalid coordinates and unsupported files do not publish',async () => {
      assert.equal((await upload('imports','evil.kml',Buffer.from('<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml>&x;</kml>'),fields)).status,400)
      const invalid=await data(await upload('imports','bad.kml',kml('BAD','181,0 182,1'),fields),201)
      assert.equal(invalid.errors.length,1)
      assert.equal((await request(`imports/${invalid.id}/publish`,'POST',{ version:'bad' })).status,422)
      assert.equal((await upload('imports','bad.exe',Buffer.from('not-kml'),fields)).status,400)
    })
    await t.test('valid KML references publish automatically without operationalizing unmapped assets',async () => {
      const xml=Buffer.from('<kml><Document><Placemark id="district-1"><name>Reference District</name><Polygon><outerBoundaryIs><LinearRing><coordinates>106.8,-6.2 106.9,-6.2 106.9,-6.3 106.8,-6.3 106.8,-6.2</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark><Placemark id="unmapped-point"><name>Unmapped asset</name><ExtendedData><Data name="treeId"><value>placemark-xhr9wha03</value></Data></ExtendedData><Point><coordinates>106.85,-6.25</coordinates></Point></Placemark></Document></kml>')
      const preview=await data(await upload('imports','district.kml',xml,{ entityId:alpha.entityId,sourceSystem:'reference-areas' }),201)
      assert.equal(preview.rows.length,0);assert.equal(preview.areas.length,1);assert.equal(preview.referenceFeatures.length,1);assert.equal(preview.errors.length,0)
      assert.ok(preview.areasPublishedAt);assert.ok(preview.datasetId)
      assert.equal((await request(`imports/${preview.id}/publish`,'POST',{ version:'areas-v1' })).status,422)
      const replay=await data(await request(`imports/${preview.id}/publish-areas`,'POST',{ version:'manual-replay' }),201)
      assert.equal(replay.datasetId,preview.datasetId)
      const stored=(await pool.query("SELECT name,ST_GeometryType(geometry) AS type FROM reference_areas WHERE external_id='district-1'")).rows[0]
      assert.equal(stored.name,'Reference District');assert.equal(stored.type,'ST_Polygon')
      const storedFeature=(await pool.query("SELECT name,ST_GeometryType(geometry) AS type FROM reference_features WHERE external_id='placemark-2'")).rows[0]
      assert.equal(storedFeature.name,'Unmapped asset');assert.equal(storedFeature.type,'ST_Point')
      const map=await data(await request(`network/map?entityId=${alpha.entityId}&bbox=106.7,-6.4,107,-6.1&layers=areas,references`),200)
      assert.ok(map.features.length>=2)
      assert.ok(map.features.some((feature)=>feature.properties.layer==='areas' && feature.properties.name==='Reference District'))
      assert.ok(map.features.some((feature)=>feature.properties.layer==='references' && feature.properties.name==='Unmapped asset'))
      assert.ok(map.features.every((feature)=>feature.properties.referenceOnly))
      assert.equal(map.features.find((feature)=>feature.properties.layer==='areas').geometry.type,'Polygon')
      const mappedReference=map.features.find((feature)=>feature.properties.layer==='references' && feature.properties.name==='Unmapped asset')
      assert.equal(mappedReference.geometry.type,'Point')
      assert.equal(mappedReference.properties.attributes.treeId,'placemark-xhr9wha03')
    })
    let bulkJob
    await t.test('address-only asset import requires owner-authorized lookup and explicit candidate confirmation before publish',async () => {
      const adapters=app.get(InternalAdapters),originalGeocode=adapters.geocode
      let calls=0
      adapters.geocode=async (address) => { calls++;assert.equal(address,'Synthetic address');return { status:'AMBIGUOUS_ADDRESS',candidates:[{ latitude:-6.21,longitude:106.84,label:'Synthetic candidate',precision:'house' }],provider:'TEST_INTERNAL',datasetVersion:'synthetic-v1' } }
      try {
        const buffer=Buffer.from('<kml><Document><Placemark id="address-node"><name>ADDRESS-NODE</name><address>Synthetic address</address><ExtendedData><Data name="kind"><value>NODE</value></Data></ExtendedData></Placemark></Document></kml>')
        const preview=await data(await upload('imports','address.kml',buffer,{ entityId:alpha.entityId,sourceSystem:'address-test' }),201)
        assert.equal(preview.rows.length,0);assert.equal(preview.errors[0].code,'ADDRESS_NEEDS_GEOCODING')
        assert.equal((await request(`imports/${preview.id}/publish`,'POST',{ version:'address-v1' })).status,422)
        assert.equal((await request(`imports/${preview.id}/rows/1/geocode`,'POST',undefined,{},bCookie)).status,404)
        assert.equal(calls,0)
        const first=await data(await request(`imports/${preview.id}/rows/1/geocode`,'POST'),201)
        assert.equal(first.rows.length,0);assert.equal(first.errors[0].candidates.length,1)
        assert.equal((await request(`imports/${preview.id}/publish`,'POST',{ version:'address-v1' })).status,422)
        const second=await data(await request(`imports/${preview.id}/rows/1/geocode`,'POST'),201)
        assert.notEqual(first.errors[0].lookupId,second.errors[0].lookupId)
        const body={ lookupId:second.errors[0].lookupId,candidateIndex:0 }
        assert.equal((await request(`imports/${preview.id}/rows/1/confirm-coordinates`,'POST',{ ...body,lookupId:first.errors[0].lookupId })).status,409)
        assert.equal((await request(`imports/${preview.id}/rows/1/confirm-coordinates`,'POST',{ ...body,candidateIndex:1 })).status,422)
        const confirmed=await data(await request(`imports/${preview.id}/rows/1/confirm-coordinates`,'POST',body),201)
        assert.deepEqual(confirmed.errors,[]);assert.deepEqual(confirmed.rows[0].geometry,{ type:'Point',coordinates:[106.84,-6.21] })
        assert.equal(confirmed.rows[0].geocoding.confirmedBy,alice.user.id)
        assert.equal(confirmed.rows[0].geocoding.datasetVersion,'synthetic-v1')
        await data(await request(`imports/${preview.id}/publish`,'POST',{ version:'address-v1' }),201)
        assert.equal((await request(`imports/${preview.id}/rows/1/geocode`,'POST')).status,409)
        assert.equal((await request(`imports/${preview.id}/rows/1/confirm-coordinates`,'POST',body)).status,409)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='IMPORT_COORDINATES_CONFIRMED'",[preview.id])).rows[0].n,1)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM network_nodes WHERE external_id='address-node'")).rows[0].n,1)
      } finally { adapters.geocode=originalGeocode }
    })
    await t.test('failed geocoding leaves import unresolved and never stages fabricated coordinates',async () => {
      const buffer=Buffer.from('<kml><Document><Placemark id="not-found"><name>NOT-FOUND</name><address>No configured provider</address><ExtendedData><Data name="kind"><value>ODP</value></Data></ExtendedData></Placemark></Document></kml>')
      const preview=await data(await upload('imports','missing.kml',buffer,{ entityId:alpha.entityId,sourceSystem:'missing-geocode' }),201)
      const result=await data(await request(`imports/${preview.id}/rows/1/geocode`,'POST'),201)
      assert.equal(result.errors[0].code,'GEOCODING_NOT_CONFIGURED');assert.equal(result.rows.length,0)
      assert.deepEqual(result.errors[0].candidates,[])
      assert.equal((await request(`imports/${preview.id}/publish`,'POST',{ version:'missing-v1' })).status,422)
      assert.equal((await request(`imports/${preview.id}/rows/1/confirm-coordinates`,'POST',{ lookupId:result.errors[0].lookupId,candidateIndex:0 })).status,422)
    })
    await t.test('bulk KML preview validates point placemarks; job requires approval and resumes from durable checkpoints',async () => {
      const buffer=Buffer.from(`<kml><Document>
        <Placemark><name>GOOD</name><Point><coordinates>106.85,-6.201</coordinates></Point><ExtendedData><Data name="notes"><value>=1+1</value></Data></ExtendedData></Placemark>
        <Placemark><name>BAD</name><Point><coordinates>106.85,91</coordinates></Point></Placemark>
        <Placemark><name>GOOD</name><Point><coordinates>106.8,-6.2</coordinates></Point></Placemark>
        <Placemark><name>ADDRESS</name><address>Provider missing</address></Placemark>
      </Document></kml>`)
      const response=await upload('analysis/uploads','input.kml',buffer,{ entityId:alpha.entityId })
      const json=await response.json();assert.equal(response.status,201,JSON.stringify(json));assert.equal(json.meta.valid,2);assert.equal(json.meta.invalid,2)
      assert.equal((await request('analysis/jobs','POST',{ uploadId:json.data.id,processValidRows:false })).status,409)
      bulkJob=await data(await request('analysis/jobs','POST',{ uploadId:json.data.id,processValidRows:true }),202)
      const same=await data(await request('analysis/jobs','POST',{ uploadId:json.data.id,processValidRows:true }),202);assert.equal(same.id,bulkJob.id)
      assert.equal((await request(`jobs/${bulkJob.id}`, 'GET',undefined,{},bCookie)).status,404)
      await runner.tick()
      let state=await data(await request(`jobs/${bulkJob.id}`));assert.equal(state.completed,3)
      await worker.close();worker=await NestFactory.createApplicationContext(WorkerModule,{ logger:false })
      await worker.get(JobRunnerService).tick()
      state=await data(await request(`jobs/${bulkJob.id}`));assert.equal(state.status,'COMPLETED_WITH_ERRORS');assert.equal(state.completed,4);assert.equal(state.succeeded,1);assert.equal(state.failed,3)
      assert.equal((await request(`jobs/${bulkJob.id}/retry`,'POST')).status,409)
      const responseFile=await request(`jobs/${bulkJob.id}/result`)
      assert.equal(responseFile.status,200)
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await responseFile.arrayBuffer()))
      assert.equal(workbook.getWorksheet('Results').rowCount,5)
      assert.equal(workbook.getWorksheet('Errors').rowCount,4)
      const results=workbook.getWorksheet('Results'),headers=results.getRow(1).values
      const notesIndex=headers.indexOf('notes');assert.equal(results.getRow(2).getCell(notesIndex).value,'=1+1')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM job_rows WHERE job_id=$1',[bulkJob.id])).rows[0].n,4)
    })
    await t.test('job cancellation is durable and stops at worker checkpoint',async () => {
      const job=await data(await request('reports/exports','POST',{ entityId:alpha.entityId }),202)
      await data(await request(`jobs/${job.id}/cancel`,'POST'),201)
      await worker.get(JobRunnerService).tick()
      assert.equal((await data(await request(`jobs/${job.id}`))).status,'CANCELLED')
      assert.equal((await request(`jobs/${job.id}/result`)).status,409)
    })
    await t.test('monitoring XLSX exports use a fixed snapshot, not later capacity',async () => {
      const job=await data(await request('reports/exports','POST',{ entityId:alpha.entityId }),202)
      const before=(await usage(imported.id)).booked
      await book(imported.id,1)
      await worker.get(JobRunnerService).tick()
      const response=await request(`jobs/${job.id}/result`);assert.equal(response.status,200)
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
      const sheet=workbook.getWorksheet('Results'),headers=sheet.getRow(1).values
      const row=sheet.getRows(2,sheet.rowCount-1).find((r) => r.getCell(headers.indexOf('segmentId')).value===imported.id)
      assert.equal(row.getCell(headers.indexOf('booked')).value,before)
      assert.equal(workbook.getWorksheet('Summary').getRow(2).getCell(2).value,job.asOf)
      const audit=await data(await request(`audit-logs?entityId=${alpha.entityId}`));assert.ok(audit.length>0)
    })
    let pointSegment,connectionPoint
    await t.test('asset KML publishes topology, cable master, poles 7/9 m and distinct ODC/ODP links',async () => {
      const type=await data(await request('network/cable-types','POST',{ entityId:alpha.entityId,code:'TEST-FO',name:'Synthetic fixture type' }),201)
      assert.equal((await request('network/cable-types','POST',{ entityId:alpha.entityId,code:'TEST-FO',name:'Different name' })).status,409)
      const placemark=(id,name,geometry) => `<Placemark id="${id}"><name>${name}</name>${geometry}</Placemark>`
      const point=(longitude) => `<Point><coordinates>${longitude},-6.21</coordinates></Point>`
      const line='<LineString><coordinates>106.84,-6.21 106.86,-6.21</coordinates></LineString>'
      const buffer=Buffer.from(`<kml><Document>${placemark('start','START',point(106.84))}${placemark('end','END',point(106.86))}${placemark('asset-line','TEST-ASSET',line)}${placemark('pole7','P7',point(106.845))}${placemark('pole9','P9',point(106.855))}${placemark('odc','ODC',point(106.845))}${placemark('odp','ODP',point(106.85))}</Document></kml>`)
      const mappings={
        '1':{ kind:'NODE',code:'START' },'2':{ kind:'NODE',code:'END' },
        '3':{ kind:'SEGMENT',code:'ASSET-LINE',cableTypeCode:'TEST-FO',installedCoreCount:12,capacityValidated:true,installationMethod:'AERIAL',roadSide:'LEFT',startNodeCode:'START',endNodeCode:'END' },
        '4':{ kind:'POLE',heightM:7,segmentCodes:['ASSET-LINE'] },'5':{ kind:'POLE',heightM:9,segmentCodes:['ASSET-LINE'] },
        '6':{ kind:'ODC',segmentCodes:['ASSET-LINE'] },'7':{ kind:'ODP',segmentCodes:['ASSET-LINE'] },
      }
      const preview=await data(await upload('imports','assets.kml',buffer,{ entityId:alpha.entityId,sourceSystem:'asset-test',mappings:JSON.stringify(mappings) }),201)
      assert.deepEqual(preview.errors,[])
      await data(await request(`imports/${preview.id}/publish`,'POST',{ version:'assets-v1' }),201)
      pointSegment=(await pool.query("SELECT id FROM network_segments WHERE external_id='asset-line'")).rows[0].id
      const detail=await data(await request(`network/segments/${pointSegment}`))
      assert.equal(detail.cableType.id,type.id)
      assert.deepEqual(detail.assets.poles.map((p) => p.heightM),[7,9])
      assert.equal(detail.assets.odcs.length,1);assert.equal(detail.assets.odps.length,1)
      assert.equal(detail.capacity.available,12)
      connectionPoint=detail.assets.odps[0].id
      assert.equal((await request(`network/segments/${pointSegment}`,'PATCH',{ startNodeId:detail.nodes.end.id,endNodeId:detail.nodes.start.id },{ 'If-Match':'1' })).status,422)
      assert.equal((await request(`network/segments/${pointSegment}`,'PATCH',{ cableName:'@invalid' },{ 'If-Match':'1' })).status,422)
      const history=await data(await request(`network/segments/${imported.id}/name-history`));assert.equal(history.length,1)
    })
    await t.test('routing and cable formula require an approved policy and validated connection point',async () => {
      const adapters=app.get(InternalAdapters),originalRoute=adapters.route
      adapters.route=async () => ({ distanceM:1000,shortestFeasibleDistanceM:900,policyVersion:'test-policy',roadDatasetVersion:'test-roads',geometry:{ type:'LineString',coordinates:[[106.851,-6.211],[106.85,-6.21]] } })
      try {
        const input={ entityId:alpha.entityId,latitude:-6.211,longitude:106.851,connectionPointId:connectionPoint,connectionPointType:'ODP' }
        const unconfigured=await data(await request('analysis','POST',input));assert.equal(unconfigured.estimatedCableLengthM,null);assert.equal(unconfigured.routeStatus,'ROUTE_POLICY_NOT_MET_OR_UNCONFIGURED')
        await changePolicy('analysis-policy',{ radiusM:5000,formulaApproved:true,slackPercent:10,extraLengthM:20,maxDetourPercent:20 })
        const result=await data(await request('analysis','POST',input))
        assert.equal(result.nearest.segmentId,pointSegment);assert.equal(result.estimationMethod,'ROAD_ROUTE_ESTIMATE');assert.equal(result.estimatedCableLengthM,1120)
        const invalid=await data(await request('analysis','POST',{ ...input,connectionPointId:randomUUID() }));assert.equal(invalid.routeStatus,'CONNECTION_POINT_NOT_VALIDATED');assert.equal(invalid.estimatedCableLengthM,null)
        const wrongType=await data(await request('analysis','POST',{ ...input,connectionPointType:'ODC' }));assert.equal(wrongType.routeStatus,'CONNECTION_POINT_NOT_VALIDATED');assert.equal(wrongType.estimatedCableLengthM,null)
        assert.equal((await request('analysis','POST',{ entityId:alpha.entityId,latitude:-6.211,longitude:106.851,connectionPointType:'ODP' })).status,400)
        assert.equal((await request('analysis','POST',{ entityId:alpha.entityId,latitude:-6.211,longitude:106.851,connectionPointId:connectionPoint })).status,400)
      } finally { adapters.route=originalRoute }
    })
    await t.test('address-only bulk geocodes through worker, uses optional validated point and exports candidates/provenance honestly',async () => {
      const adapters=worker.get(InternalAdapters),originalGeocode=adapters.geocode,originalRoute=adapters.route
      const addresses=[]
      adapters.geocode=async (address) => { addresses.push(address);return address==='Synthetic ambiguous' ? { status:'AMBIGUOUS_ADDRESS',candidates:[{ latitude:-6.211,longitude:106.851,label:'Synthetic candidate' }],provider:'TEST_INTERNAL',datasetVersion:'synthetic-v1' } : { status:'OK',candidate:{ latitude:-6.211,longitude:106.851,label:'Synthetic address' },provider:'TEST_INTERNAL',datasetVersion:'synthetic-v1' } }
      adapters.route=async () => ({ distanceM:1000,shortestFeasibleDistanceM:900,policyVersion:'synthetic-policy',roadDatasetVersion:'synthetic-roads',geometry:{ type:'LineString',coordinates:[[106.851,-6.211],[106.85,-6.21]] } })
      try {
        const buffer=Buffer.from(`<kml><Document>
          <Placemark id="ADDRESS-ONLY"><name>ADDRESS-ONLY</name><address>Synthetic address</address><ExtendedData><Data name="connection_point_id"><value>${connectionPoint}</value></Data><Data name="connection_point_type"><value>ODP</value></Data></ExtendedData></Placemark>
          <Placemark><name>AMBIGUOUS</name><address>Synthetic ambiguous</address></Placemark>
          <Placemark><name>COORDINATES</name><address>Metadata only</address><Point><coordinates>106.851,-6.211</coordinates></Point></Placemark>
        </Document></kml>`)
        const preview=await data(await upload('analysis/uploads','addresses.kml',buffer,{ entityId:alpha.entityId }),201)
        const job=await data(await request('analysis/jobs','POST',{ uploadId:preview.id,processValidRows:true }),202)
        for (let i=0;i<3;i++) await worker.get(JobRunnerService).tick()
        assert.deepEqual(addresses,['Synthetic address','Synthetic ambiguous'])
        const state=await data(await request(`jobs/${job.id}`));assert.equal(state.status,'COMPLETED_WITH_ERRORS');assert.equal(state.succeeded,2);assert.equal(state.failed,1)
        const rows=await data(await request(`jobs/${job.id}/rows`))
        const good=rows.find((row) => row.referenceId==='ADDRESS-ONLY');assert.equal(good.result.estimatedCableLengthM,1120);assert.equal(good.result.geocodingProvider,'TEST_INTERNAL');assert.equal(good.result.geocodingDatasetVersion,'synthetic-v1')
        const ambiguous=rows.find((row) => row.referenceId==='AMBIGUOUS');assert.equal(ambiguous.result.status,'AMBIGUOUS_ADDRESS');assert.equal(ambiguous.result.coordinates,undefined)
        const response=await request(`jobs/${job.id}/result`),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
        const sheet=workbook.getWorksheet('Results'),headers=sheet.getRow(1).values
        const output=sheet.getRows(2,sheet.rowCount-1).find((row) => row.getCell(headers.indexOf('reference_id')).value==='ADDRESS-ONLY')
        assert.equal(output.getCell(headers.indexOf('estimated_cable_length_m')).value,1120)
        assert.equal(output.getCell(headers.indexOf('connection_point_id')).value,connectionPoint)
        assert.equal(output.getCell(headers.indexOf('connection_point_type')).value,'ODP')
        assert.equal(output.getCell(headers.indexOf('geocoding_dataset_version')).value,'synthetic-v1')
        const error=workbook.getWorksheet('Errors').getRow(2)
        assert.match(error.getCell(headers.indexOf('geocoding_candidates')).value,/Synthetic candidate/)
      } finally { adapters.geocode=originalGeocode;adapters.route=originalRoute }
    })
    await t.test('expired worker lease is recovered; committed row results are never duplicated',async () => {
      const buffer=Buffer.from('<kml><Document><Placemark><name>LEASE</name><Point><coordinates>106.85,-6.2</coordinates></Point></Placemark></Document></kml>')
      const preview=await data(await upload('analysis/uploads','lease.kml',buffer,{ entityId:alpha.entityId }),201)
      const job=await data(await request('analysis/jobs','POST',{ uploadId:preview.id,processValidRows:true }),202)
      const staleToken=randomUUID()
      await pool.query("UPDATE jobs SET status='RUNNING',attempts=1,lease_token=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id,staleToken])
      await worker.get(JobRunnerService).tick()
      const state=await data(await request(`jobs/${job.id}`));assert.equal(state.status,'COMPLETED');assert.equal(state.attempts,2);assert.equal(state.completed,1)
      await worker.get(JobRunnerService).checkpoint({ id:job.id,leaseToken:staleToken },null,{ arbitrary:'stale result' })
      assert.equal((await data(await request(`jobs/${job.id}`))).succeeded,1)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM job_rows WHERE job_id=$1 AND result IS NOT NULL',[job.id])).rows[0].n,1)
    })
    await t.test('explicit retry copies only transient failures, leaving successful rows untouched',async () => {
      const adapters=worker.get(InternalAdapters),originalGeocode=adapters.geocode
      let calls=0
      adapters.geocode=async () => { calls++;return { status:'GEOCODING_UNAVAILABLE' } }
      try {
        const buffer=Buffer.from('<kml><Document><Placemark><name>OK</name><Point><coordinates>106.85,-6.2</coordinates></Point></Placemark><Placemark><name>RETRY</name><address>Synthetic test address</address></Placemark></Document></kml>')
        const preview=await data(await upload('analysis/uploads','retry.kml',buffer,{ entityId:alpha.entityId }),201)
        const job=await data(await request('analysis/jobs','POST',{ uploadId:preview.id,processValidRows:true }),202)
        await worker.get(JobRunnerService).tick();await worker.get(JobRunnerService).tick()
        assert.equal(calls,1)
        const retry=await data(await request(`jobs/${job.id}/retry`,'POST'),202)
        assert.equal((await data(await request(`jobs/${retry.id}`))).total,1)
        adapters.geocode=async () => { calls++;return { status:'OK',candidate:{ latitude:-6.2,longitude:106.85,label:'Test only' } } }
        await worker.get(JobRunnerService).tick()
        assert.equal(calls,2);assert.equal((await data(await request(`jobs/${retry.id}`))).status,'COMPLETED')
        assert.equal((await data(await request(`jobs/${job.id}`))).status,'COMPLETED_WITH_ERRORS')
      } finally { adapters.geocode=originalGeocode }
    })
    await t.test('competing approval decisions are atomic and stale proposals cannot replace the winner',async () => {
      const first=await data(await propose('booking-policy',{ duration:3,unit:'DAY' },1),202)
      const second=await data(await propose('booking-policy',{ duration:4,unit:'DAY' },1),202)
      const responses=await Promise.all([first,second].map((row) => request(`settings/requests/${row.id}/approve`,'POST',{ reason:'Concurrent independent review' },{},bCookie)))
      assert.deepEqual(responses.map((response) => response.status).sort(),[201,409])
      const winner=await data(responses.find((response) => response.status===201),201)
      const current=await data(await request(`settings/booking-policy?entityId=${alpha.entityId}`))
      assert.equal(current.version,2);assert.equal(current.changeRequestId,winner.id)
      assert.equal((await propose('booking-policy',{ duration:5,unit:'DAY' },1)).status,409)
      const loser=[first,second].find((row) => row.id!==winner.id)
      await data(await request(`settings/requests/${loser.id}/reject`,'POST',{ reason:'Superseded fixture proposal' },{},bCookie),201)
      const list=await data(await request(`settings/requests?entityId=${alpha.entityId}&key=booking-policy`))
      assert.deepEqual(list.find((row) => row.id===first.id).baseValue,{ duration:2,unit:'DAY' })
      await assert.rejects(pool.query('UPDATE settings SET value=$2 WHERE id=$1',[current.id,JSON.stringify({ duration:99,unit:'DAY' })]),{ code:'23514' })
    })
    await t.test('revocation blocks both requester activation and reviewer decisions without losing pending requests',async () => {
      const proposal=await data(await propose('booking-policy',{ duration:5,unit:'DAY' },2),202)
      await grants.revoke({ email:'alice@example.test',entityCode:'ALPHA',roleCode:'ops',source:'integration-test' })
      assert.equal((await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Revoked requester' },{},bCookie)).status,409)
      await grants.grant({ email:'alice@example.test',entityCode:'ALPHA',entityName:'Test Alpha',roleCode:'ops',permissions:permissionList,source:'integration-test' })
      await grants.revoke({ email:'bob@example.test',entityCode:'ALPHA',roleCode:'reviewer-operational',source:'integration-test' })
      assert.equal((await request(`settings/requests/${proposal.id}/approve`,'POST',{ reason:'Revoked reviewer' },{},bCookie)).status,403)
      await grants.grant({ email:'bob@example.test',entityCode:'ALPHA',entityName:'Test Alpha',roleCode:'reviewer-operational',permissions:['settings.read','settings.approve-operational','notifications.read'],source:'integration-test' })
      await data(await request(`settings/requests/${proposal.id}/cancel`,'POST',{ reason:'End revoked fixture' }),201)
      const active=await data(await request(`settings/booking-policy?entityId=${alpha.entityId}`))
      assert.equal(active.version,2)
    })
    await t.test('policy outbox reaches authorized reviewers and requester through the existing worker',async () => {
      await worker.get(JobRunnerService).tick()
      const own=await data(await request(`notifications?entityId=${alpha.entityId}&pageSize=100`))
      const review=await data(await request(`notifications?entityId=${alpha.entityId}&pageSize=100`,'GET',undefined,{},bCookie))
      assert.ok(own.some((row) => row.type==='POLICY_CHANGE_REQUESTED'))
      assert.ok(review.some((row) => row.type==='POLICY_CHANGE_REQUESTED'))
      assert.ok(own.some((row) => row.type==='POLICY_CHANGE_APPROVED'))
      const valueLeaks=own.filter((row) => row.type.startsWith('POLICY_CHANGE_')).some((row) => 'proposedValue' in row.payload)
      assert.equal(valueLeaks,false)
    })
    await t.test('job quota is transactional; revoked entity grants also block worker/download',async () => {
      const first=await data(await request('reports/exports','POST',{ entityId:alpha.entityId }),202)
      const second=await data(await request('reports/exports','POST',{ entityId:alpha.entityId }),202)
      assert.equal((await request('reports/exports','POST',{ entityId:alpha.entityId })).status,429)
      await request(`jobs/${first.id}/cancel`,'POST');await request(`jobs/${second.id}/cancel`,'POST')
      await worker.get(JobRunnerService).tick();await worker.get(JobRunnerService).tick()
      const bob=await data(await request('reports/exports','POST',{ entityId:beta.entityId },{},bCookie),202)
      await grants.revoke({ email:'bob@example.test',entityCode:'BETA',roleCode:'ops',source:'integration-test' })
      await worker.get(JobRunnerService).tick()
      assert.equal((await pool.query('SELECT error FROM jobs WHERE id=$1',[bob.id])).rows[0].error,'PERMISSION_REVOKED')
      assert.equal((await request(`jobs/${bob.id}/result`,'GET',undefined,{},bCookie)).status,404)
    })
    await t.test('real HTTP bootstrap enforces Origin on JSON/multipart and requires valid sessions',async () => {
      const listener=createServer()
      await new Promise((resolve) => listener.listen(0,'127.0.0.1',resolve))
      const port=listener.address().port
      await new Promise((resolve) => listener.close(resolve))
      const child=spawn(process.execPath,['dist/main.js'],{ env:{ ...process.env,PORT:String(port) },stdio:['ignore','pipe','pipe'] })
      try {
        await new Promise((resolve,reject) => {
          const timeout=setTimeout(() => reject(new Error('HTTP bootstrap did not start')),10000)
          let output=''
          child.stdout.on('data',(chunk) => {
            output=(output+chunk.toString()).slice(-2000)
            if (output.includes('API_LISTENING')) { clearTimeout(timeout);resolve() }
          })
          child.once('exit',() => { clearTimeout(timeout);reject(new Error('HTTP bootstrap exited unexpectedly')) })
          child.stderr.on('data',() => {})
        })
        const base=`http://127.0.0.1:${port}/api/v1`
        assert.equal((await fetch(`${base}/health/ready`)).status,200)
        assert.equal((await fetch(`${base}/bookings?entityId=${alpha.entityId}`)).status,401)
        const body=JSON.stringify({ entityId:alpha.entityId,latitude:-6.2,longitude:106.85 })
        for (const extra of [{},{ Origin:'https://untrusted.example.test' }]) assert.equal((await fetch(`${base}/analysis`,{ method:'POST',headers:{ Cookie:aCookie,'Content-Type':'application/json',...extra },body })).status,403)
        assert.equal((await fetch(`${base}/analysis`,{ method:'POST',headers:{ Cookie:aCookie,'Content-Type':'application/json',Origin:config.trustedOrigins[0] },body })).status,200)
        const form=new FormData();form.set('entityId',alpha.entityId);form.set('file',new Blob(['bad']),'test.xlsx')
        assert.equal((await fetch(`${base}/analysis/uploads`,{ method:'POST',headers:{ Cookie:aCookie },body:form })).status,403)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited=once(child,'exit')
          child.kill()
          await exited
        }
      }
    })
  } finally {
    if (worker) await worker.close()
    if (app) await app.close()
    if (pool) await pool.end()
    if (legacyFolder) await rm(legacyFolder,{ recursive:true,force:true })
    for (const [key,value] of Object.entries(original)) { if (value===undefined) delete process.env[key];else process.env[key]=value }
    if (created) await admin.query(`DROP DATABASE "${name}"`)
    await admin.end()
  }
})
