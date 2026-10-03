import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { RE2JS } from 're2js'
import { z } from 'zod'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { auditLogs, cableNameHistory, cableTypes, networkSegments } from '../../database/schema/index.js'
import { currentSetting, namingPolicySchema } from '../settings/settings.service.js'
import { CapacityRepository, readUsage } from '../capacity/capacity.repository.js'
import { parseInput } from '../../common/domain-input.js'
import { AccessService } from '../access/access.service.js'

export async function validateCableName(tx: Transaction, entityId: string, name: string, segmentId?: string) {
  const setting = await currentSetting(tx, entityId, 'naming-policy')
  const policy = namingPolicySchema.parse(setting?.value ?? { approved: false, pattern: null, uniquePerEntity: true })
  if (!policy.approved || !policy.pattern) throw new UnprocessableEntityException('Official naming policy has not been configured and approved')
  if (!RE2JS.compile(policy.pattern).matches(name)) throw new UnprocessableEntityException('Cable name does not match the approved policy')
  const [duplicate] = await tx.select({ id: networkSegments.id }).from(networkSegments).where(and(eq(networkSegments.ownerEntityId, entityId), eq(networkSegments.cableName, name), segmentId ? ne(networkSegments.id, segmentId) : undefined)).limit(1)
  if (duplicate) throw new ConflictException('Cable name is already used in this entity')
  return setting!.version
}

const metadataSchema = z.object({
  cableName: z.string().trim().min(1).max(200).optional(), cableTypeId: z.uuid().nullable().optional(),
  installedCoreCount: z.number().int().min(1).max(1_000_000).optional(), capacityValidated: z.boolean().optional(),
  installationMethod: z.enum(['BURIAL','AERIAL']).nullable().optional(), roadSide: z.enum(['LEFT','RIGHT']).nullable().optional(),
  startNodeId: z.uuid().nullable().optional(), endNodeId: z.uuid().nullable().optional(), status: z.enum(['ACTIVE','INACTIVE']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'No update fields')

@Injectable()
export class AssetsService {
  constructor(private readonly database: DatabaseService, private readonly capacity: CapacityRepository,private readonly access: AccessService) {}
  async nameHistory(userId: string,id: string,page: number,pageSize: number) {
    await this.capacity.authorizeSegment(userId,id,'network.read')
    const data = await this.database.db.select().from(cableNameHistory).where(eq(cableNameHistory.segmentId,id)).orderBy(desc(cableNameHistory.createdAt),desc(cableNameHistory.id)).limit(pageSize).offset((page-1)*pageSize)
    const [{ total }] = await this.database.db.select({ total:sql<number>`count(*)::int` }).from(cableNameHistory).where(eq(cableNameHistory.segmentId,id))
    return { data,meta:{ page,pageSize,total } }
  }
  async types(userId: string,entityId: string,page: number,pageSize: number) {
    await this.access.requireEntityPermission(userId,entityId,'network.read')
    const data = await this.database.db.select().from(cableTypes).orderBy(cableTypes.code).limit(pageSize).offset((page-1)*pageSize)
    const [{ total }] = await this.database.db.select({ total:sql<number>`count(*)::int` }).from(cableTypes)
    return { data,meta:{ page,pageSize,total } }
  }
  async createType(userId: string,entityId: string,code: string,name: string) {
    await this.access.requireEntityPermission(userId,entityId,'network.master-write')
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx.insert(cableTypes).values({ code,name }).onConflictDoNothing().returning()
      const existing = created ?? (await tx.select().from(cableTypes).where(eq(cableTypes.code,code)))[0]
      if (existing.name !== name) throw new ConflictException('Existing master cable type cannot be changed through create')
      if (created) await tx.insert(auditLogs).values({ entityId,actorId:userId,action:'CABLE_TYPE_CREATED',resourceId:created.id,details:{ code,name } })
      return { data:existing }
    })
  }
  async update(userId: string, id: string, version: number, input: unknown) {
    const data = parseInput(metadataSchema, input)
    const scope = await this.capacity.authorizeSegment(userId, id, 'network.write')
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.entityId + ':network-write'}, 0))`)
      const segment = await this.capacity.lock(tx, id)
      if (segment.version !== version) throw new ConflictException('Segment version changed')
      const usage = await readUsage(tx, segment)
      if (data.capacityValidated === false && usage.used + usage.booked > 0) throw new ConflictException('Active usage requires validated capacity')
      if ((data.startNodeId !== undefined || data.endNodeId !== undefined) && segment.roadSide && data.roadSide === undefined) throw new UnprocessableEntityException('Topology change requires road-side confirmation')
      if (data.installedCoreCount !== undefined && data.installedCoreCount < usage.used + usage.booked) throw new ConflictException('Installed core cannot be less than Used + active Booked')
      let policyVersion = 0
      if (data.cableName && data.cableName !== segment.cableName) policyVersion = await validateCableName(tx, segment.ownerEntityId, data.cableName, id)
      const [record] = await tx.update(networkSegments).set({ ...data, version: segment.version + 1, updatedAt: sql`clock_timestamp()` }).where(eq(networkSegments.id, id)).returning()
      if (data.cableName && data.cableName !== segment.cableName) await tx.insert(cableNameHistory).values({ segmentId: id, oldName: segment.cableName, newName: data.cableName, policyVersion, actorId: userId })
      await tx.insert(auditLogs).values({ entityId: segment.ownerEntityId, actorId: userId, action: 'SEGMENT_UPDATED', resourceId: id, details: { fields: data, version: record.version } })
      return { data: { id: record.id, version: record.version } }
    })
  }
}
