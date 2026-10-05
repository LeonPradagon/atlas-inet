import { ConflictException, GoneException, HttpException, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { analysisUploads, auditLogs, jobRows, jobs } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { spreadsheet, type UploadFile } from '../files/tabular-files.js'
import { utilization } from '../reports/reports.service.js'
import { parseBulkFile } from './bulk-parser.js'

export type Job = typeof jobs.$inferSelect
export const jobPermission = (job: Pick<Job, 'type'>) => job.type === 'ANALYSIS' ? 'analysis.bulk' : 'reports.export'
export const transientCodes = ['GEOCODING_UNAVAILABLE','DEPENDENCY_UNAVAILABLE']

@Injectable()
export class JobsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}
  async upload(userId: string, entityId: string, file: UploadFile) {
    await this.access.requireEntityPermission(userId, entityId, 'analysis.bulk')
    const rows = await parseBulkFile(file, entityId)
    const [upload] = await this.database.db.insert(analysisUploads).values({ ownerId: userId, entityId, rows, sourceName: file.originalname }).returning()
    return { data: { id: upload.id, preview: rows.slice(0,100) }, meta: { total: rows.length, valid: rows.filter((r) => !r.error).length, invalid: rows.filter((r) => r.error).length, previewLimit: 100 } }
  }
  private async quota(tx: Transaction, userId: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ':job-quota'},0))`)
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.ownerId,userId),inArray(jobs.status,['QUEUED','RUNNING'])))
    if (count >= 2) throw new HttpException('At most two active jobs per user',429)
  }
  async submit(userId: string, uploadId: string, processValidRows: boolean) {
    const [upload] = await this.database.db.select().from(analysisUploads).where(and(eq(analysisUploads.id,uploadId),eq(analysisUploads.ownerId,userId)))
    if (!upload) throw new NotFoundException('Upload not found')
    await this.access.requireEntityPermission(userId, upload.entityId,'analysis.bulk')
    await this.access.requireEntityPermission(userId, upload.entityId,'analysis.create')
    if (!processValidRows) throw new ConflictException('Explicit approval to process valid rows is required')
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(analysisUploads).where(eq(analysisUploads.id,uploadId)).for('update')
      if (current.jobId) return { data: { id: current.jobId } }
      await this.quota(tx,userId)
      const rows = current.rows as { rowNumber: number; referenceId: string; input: Record<string, unknown>; error: string | null }[]
      const invalid = rows.filter((r) => r.error).length
      const [job] = await tx.insert(jobs).values({ entityId: upload.entityId, ownerId:userId,type:'ANALYSIS',input:{ uploadId },total:rows.length,completed:invalid,failed:invalid }).returning()
      for (let offset = 0; offset < rows.length; offset += 250) await tx.insert(jobRows).values(rows.slice(offset,offset+250).map((row) => ({ jobId:job.id,...row, result:row.error ? { status:'VALIDATION_ERROR' } : null })))
      await tx.update(analysisUploads).set({ jobId:job.id }).where(eq(analysisUploads.id,uploadId))
      await tx.insert(auditLogs).values({ entityId: job.entityId, actorId:userId,action:'ANALYSIS_JOB_CREATED',resourceId:job.id,details:{ total:job.total, invalid } })
      return { data: { id: job.id } }
    })
  }
  async export(userId: string, entityId: string) {
    await this.access.requireEntityPermission(userId,entityId,'reports.export')
    return this.database.db.transaction(async (tx) => {
      await this.quota(tx,userId)
      const report = await utilization(tx,entityId,1,10_000)
      if (report.meta.total > 10_000) throw new ConflictException('Export exceeds the current 10,000-segment limit; narrow entity scope')
      const [job] = await tx.insert(jobs).values({ entityId,ownerId:userId,type:'UTILIZATION_EXPORT',input:{ snapshot:report },total:1 }).returning()
      await tx.insert(auditLogs).values({ entityId, actorId:userId, action:'REPORT_EXPORT_CREATED',resourceId:job.id,details:{ asOf:report.meta.asOf,total:report.meta.total } })
      return { data: { id:job.id,asOf:report.meta.asOf } }
    })
  }
  async authorize(userId: string, id: string, manage = false) {
    const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id,id))
    if (!job) throw new NotFoundException('Job not found')
    const entity = (await this.access.getUserAccess(userId)).find((e) => e.id === job.entityId && e.permissions.includes(jobPermission(job)))
    if (!entity || (job.ownerId !== userId && !entity.permissions.includes(manage ? 'jobs.manage' : 'jobs.read'))) throw new NotFoundException('Job not found')
    return job
  }
  async get(userId: string, id: string) {
    const job = await this.authorize(userId,id)
    return { data: { id:job.id,entityId:job.entityId,type:job.type,status:job.status,total:job.total,completed:job.completed,succeeded:job.succeeded,failed:job.failed,attempts:job.attempts,error:job.error,cancelRequestedAt:job.cancelRequestedAt,createdAt:job.createdAt,finishedAt:job.finishedAt } }
  }
  async rows(userId: string, id: string, page: number, pageSize: number) {
    await this.authorize(userId,id)
    const data = await this.database.db.select().from(jobRows).where(eq(jobRows.jobId,id)).orderBy(asc(jobRows.rowNumber)).limit(pageSize).offset((page-1)*pageSize)
    const [{ total }] = await this.database.db.select({ total:sql<number>`count(*)::int` }).from(jobRows).where(eq(jobRows.jobId,id))
    return { data,meta:{ page,pageSize,total } }
  }
  async cancel(userId: string, id: string) {
    await this.authorize(userId,id,true)
    const [job] = await this.database.db.update(jobs).set({ cancelRequestedAt:sql`COALESCE(cancel_requested_at,clock_timestamp())` }).where(and(eq(jobs.id,id),inArray(jobs.status,['QUEUED','RUNNING']))).returning()
    return job ? { data:{ id,status:job.status,cancelRequestedAt:job.cancelRequestedAt } } : this.get(userId,id)
  }
  async retry(userId: string, id: string) {
    const original = await this.authorize(userId,id,true)
    if (original.type !== 'ANALYSIS' || !['COMPLETED_WITH_ERRORS','FAILED'].includes(original.status)) throw new ConflictException('Only terminal analysis jobs can be retried')
    await this.access.requireEntityPermission(userId,original.entityId,'analysis.create')
    const rows = await this.database.db.select().from(jobRows).where(and(eq(jobRows.jobId,id),sql`${jobRows.result}->>'status' = ANY(ARRAY[${sql.join(transientCodes.map((c) => sql`${c}`),sql`, `)}]::text[])`)).orderBy(jobRows.rowNumber)
    if (!rows.length) throw new ConflictException('No transient row failures to retry')
    return this.database.db.transaction(async (tx) => {
      await this.quota(tx,userId)
      const [job] = await tx.insert(jobs).values({ entityId:original.entityId,ownerId:userId,type:'ANALYSIS',input:{ previousJobId:id },total:rows.length }).returning()
      for (let i=0;i<rows.length;i+=250) await tx.insert(jobRows).values(rows.slice(i,i+250).map((r) => ({ jobId:job.id,rowNumber:r.rowNumber,referenceId:r.referenceId,input:r.input })))
      return { data:{ id:job.id,previousJobId:id } }
    })
  }
  async result(userId: string,id: string) {
    const job = await this.authorize(userId,id)
    if (!['COMPLETED','COMPLETED_WITH_ERRORS'].includes(job.status)) throw new ConflictException('Job result is not ready')
    if (Date.now()-job.createdAt.getTime()>30*86400_000) throw new GoneException('Download retention has expired')
    if (job.type === 'UTILIZATION_EXPORT') {
      const report = job.output as { data:Record<string,unknown>[];meta:Record<string,unknown> }
      return spreadsheet([{ name:'Results',columns:['segmentId','segmentCode','cableName','datasetVersion','total','used','booked','idle','available','waitingCount','waitingCores'],rows:report.data },{ name:'Summary',columns:['entityId','asOf','total'],rows:[report.meta] }])
    }
    const rows = await this.database.db.select().from(jobRows).where(eq(jobRows.jobId,id)).orderBy(jobRows.rowNumber)
    const output = rows.map((row) => {
      const result = row.result ?? {}
      const nearest = result.nearest as Record<string,unknown> | null
      const coordinates = result.coordinates as Record<string,unknown> | null
      return { row_number:row.rowNumber,reference_id:row.referenceId,...row.input,latitude:coordinates?.latitude ?? row.input.latitude,longitude:coordinates?.longitude ?? row.input.longitude,
        status:result.status,segment_id:nearest?.segmentId,cable_name:nearest?.cableName,nearest_distance_m:result.nearestNetworkDistanceM,estimated_cable_length_m:result.estimatedCableLengthM,estimation_method:result.estimationMethod,dataset_version:nearest?.datasetVersion,analysis_time:result.analysisTime,error:row.error,
        coordinate_source:result.coordinateSource,geocoding_provider:result.geocodingProvider ?? result.provider,geocoding_dataset_version:result.geocodingDatasetVersion ?? result.datasetVersion,
        geocoding_candidates:result.candidates ? JSON.stringify(result.candidates) : '',route_status:result.routeStatus,route_distance_m:(result.route as Record<string,unknown> | null)?.distanceM,formula_version:result.formulaVersion,needs_survey:result.needsSurvey }
    })
    const columns = ['row_number','reference_id','customer_name','address','latitude','longitude','notes','connection_point_id','connection_point_type','status','segment_id','cable_name','nearest_distance_m','estimated_cable_length_m','estimation_method','dataset_version','analysis_time','error','coordinate_source','geocoding_provider','geocoding_dataset_version','geocoding_candidates','route_status','route_distance_m','formula_version','needs_survey']
    return spreadsheet([{ name:'Results',columns,rows:output },{ name:'Errors',columns,rows:output.filter((r) => r.error) },{ name:'Summary',columns:['id','total','completed','succeeded','failed','createdAt','finishedAt'],rows:[job] }])
  }
}
