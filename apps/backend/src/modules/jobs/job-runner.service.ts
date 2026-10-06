import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { APP_CONFIG,type AppConfig } from '../../config/app-config.js'
import { DatabaseService } from '../../database/database.service.js'
import { auditLogs,jobRows,jobs } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { analysisSchema } from '../analysis/analysis.dto.js'
import { AnalysisService } from '../analysis/analysis.service.js'
import { CapacityService } from '../capacity/capacity.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { jobPermission,type Job } from './jobs.service.js'

@Injectable()
export class JobRunnerService {
  constructor(private readonly database: DatabaseService,private readonly access: AccessService,private readonly analysis: AnalysisService,
    private readonly capacity: CapacityService,private readonly notifications: NotificationsService,@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async tick() {
    if (this.config.databasePoolSize < 2) throw new Error('Worker requires DATABASE_POOL_SIZE >= 2')
    const client = await this.database.pool.connect()
    let locked = false
    try {
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended('atlas-worker',0)) AS locked")).rows[0].locked
      if (!locked) return false
      await this.capacity.expireBatch()
      await this.notifications.deliverBatch()
      const claimed = await this.database.db.execute<{ id:string }>(sql`WITH candidate AS (
        SELECT id FROM jobs WHERE status='QUEUED' OR (status='RUNNING' AND lease_until < clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE jobs j SET status='RUNNING',attempts=CASE WHEN j.status='RUNNING' THEN j.attempts+1 ELSE GREATEST(j.attempts,1) END,
        lease_token=${randomUUID()}::uuid,lease_until=clock_timestamp()+interval '30 seconds'
      FROM candidate WHERE j.id=candidate.id RETURNING j.id`)
      if (!claimed.rows[0]) return false
      const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id,claimed.rows[0].id))
      try { await this.process(job) } catch {
        // A database/worker failure is recoverable via the lease. Provider failures are row results.
        if (job.attempts >= 3) await this.database.db.transaction(async (tx) => {
          const [failed] = await tx.update(jobs).set({ status:'FAILED',error:'WORKER_FAILED',finishedAt:sql`clock_timestamp()`,leaseToken:null,leaseUntil:null })
            .where(and(eq(jobs.id,job.id),eq(jobs.leaseToken,job.leaseToken!))).returning()
          if (failed) await tx.insert(auditLogs).values({ entityId: job.entityId, actorId: 'worker', action: 'JOB_FAILED', resourceId: job.id,
            details: { type: job.type, status: failed.status, reason: 'WORKER_FAILED' } })
        })
      }
      return true
    } finally {
      try {
        if (locked) {
          // Keep the singleton lock during the interval: aggregate provider rate stays bounded across workers.
          await delay(this.config.workerIntervalMs)
          await client.query("SELECT pg_advisory_unlock(hashtextextended('atlas-worker',0))")
        }
      } finally { client.release() }
    }
  }

  private async process(job: Job) {
    const permission = jobPermission(job)
    try { await this.access.requireEntityPermission(job.ownerId,job.entityId,permission) } catch {
      await this.database.db.transaction(async (tx) => {
        const [failed] = await tx.update(jobs).set({ status:'FAILED',error:'PERMISSION_REVOKED',finishedAt:sql`clock_timestamp()`,leaseToken:null,leaseUntil:null })
          .where(and(eq(jobs.id,job.id),eq(jobs.leaseToken,job.leaseToken!))).returning()
        if (failed) await tx.insert(auditLogs).values({ entityId: job.entityId, actorId: 'worker', action: 'JOB_FAILED', resourceId: job.id,
          details: { type: job.type, status: failed.status, reason: 'PERMISSION_REVOKED' } })
      })
      return
    }
    if (job.cancelRequestedAt) { await this.checkpoint(job,null,null); return }
    if (job.type === 'UTILIZATION_EXPORT') { await this.checkpoint(job,null,job.input.snapshot as Record<string,unknown>); return }
    if (job.type !== 'ANALYSIS') throw new Error('Unknown job type')
    const [row] = await this.database.db.select().from(jobRows).where(and(eq(jobRows.jobId,job.id),isNull(jobRows.result),isNull(jobRows.error))).orderBy(asc(jobRows.rowNumber)).limit(1)
    if (!row) { await this.checkpoint(job,null,null); return }
    const input = analysisSchema.parse(row.input.analysis)
    const result = await this.analysis.analyze(job.ownerId,input,false)
    await this.checkpoint(job,row.id,result)
  }

  private async checkpoint(job: Job,rowId: string | null,result: Record<string,unknown> | null) {
    await this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(jobs).where(and(eq(jobs.id,job.id),eq(jobs.leaseToken,job.leaseToken!),sql`${jobs.leaseUntil}>clock_timestamp()`)).for('update')
      if (!current) return // Fencing: stale workers cannot persist results or counters.
      if (current.cancelRequestedAt) {
        await tx.update(jobs).set({ status:'CANCELLED',finishedAt:sql`clock_timestamp()`,leaseToken:null,leaseUntil:null }).where(eq(jobs.id,job.id))
        await tx.insert(auditLogs).values({ entityId: current.entityId, actorId: 'worker', action: 'JOB_CANCELLED', resourceId: current.id,
          details: { type: current.type, completed: current.completed, total: current.total } })
        return
      }
      let succeeded = current.succeeded
      let failed = current.failed
      if (rowId && result) {
        const successful = ['OK','NO_NETWORK_IN_RADIUS'].includes(String(result.status))
        const [saved] = await tx.update(jobRows).set({ result,error:successful ? null : String(result.status) }).where(and(eq(jobRows.id,rowId),isNull(jobRows.result))).returning({ id:jobRows.id })
        if (saved) { if (successful) succeeded++;else failed++ }
      } else if (current.type === 'UTILIZATION_EXPORT') succeeded=1
      const completed = succeeded+failed
      const done = completed === current.total
      const status = done ? failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED' : 'QUEUED'
      await tx.update(jobs).set({ succeeded,failed,completed,status,
        output:current.type === 'UTILIZATION_EXPORT' ? result : null,finishedAt:done ? sql`clock_timestamp()` : null,leaseToken:null,leaseUntil:null }).where(eq(jobs.id,job.id))
      if (done) await tx.insert(auditLogs).values({ entityId: current.entityId, actorId: 'worker',
        action: current.type === 'UTILIZATION_EXPORT' ? 'REPORT_EXPORT_COMPLETED' : 'ANALYSIS_JOB_COMPLETED', resourceId: current.id,
        details: { type: current.type, status, total: current.total, succeeded, failed } })
    })
  }
}
