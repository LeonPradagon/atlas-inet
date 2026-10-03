import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { auditLogs, outboxEvents, policyChangeRequests, settings } from '../../database/schema/index.js'
import { entityPageSchema, parseInput, reasonSchema } from '../../common/domain-input.js'
import { AccessService } from '../access/access.service.js'
import { approvalPermission, defaultPolicy, parsePolicy, settingKeySchema, type SettingKey } from './policy-input.js'
import { currentSetting } from './settings.service.js'

export const policyRequestsQuery = entityPageSchema.extend({
  key: settingKeySchema.optional(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
})
const proposalSchema = reasonSchema.extend({ value: z.unknown() }).strict()
type PolicyRequest = typeof policyChangeRequests.$inferSelect
type Decision = 'APPROVED' | 'REJECTED' | 'CANCELLED'

async function effect(tx: Transaction, request: PolicyRequest, actorId: string, action: string) {
  await tx.insert(auditLogs).values({ entityId: request.entityId, actorId, action, resourceId: request.id,
    details: { key: request.key, baseVersion: request.baseVersion, approvedVersion: request.approvedVersion, status: request.status, reason: request.decisionReason ?? request.reason } })
  // Reuse the durable in-app outbox, without publishing policy values or contacts.
  await tx.insert(outboxEvents).values({ entityId: request.entityId, type: action,
    payload: { resourceId: request.id, key: request.key, status: request.status, recipientUserId: request.requestedBy, approvalPermission: approvalPermission(request.key as SettingKey) } })
}

@Injectable()
export class PolicyRequestsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}

  async list(userId: string, query: z.infer<typeof policyRequestsQuery>) {
    await this.access.requireEntityPermission(userId, query.entityId, 'settings.read')
    const where = and(eq(policyChangeRequests.entityId, query.entityId), query.key ? eq(policyChangeRequests.key, query.key) : undefined,
      query.status ? eq(policyChangeRequests.status, query.status) : undefined)
    const data = await this.database.db.select().from(policyChangeRequests).where(where)
      .orderBy(desc(policyChangeRequests.createdAt), desc(policyChangeRequests.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize)
    const [{ total }] = await this.database.db.select({ total: sql<number>`count(*)::int` }).from(policyChangeRequests).where(where)
    const versions = [...new Set(data.map((row) => row.baseVersion).filter((version) => version > 0))]
    const bases = versions.length ? await this.database.db.select().from(settings).where(and(eq(settings.entityId, query.entityId), inArray(settings.version, versions))) : []
    return { data: data.map((row) => ({ ...row, baseValue: row.baseVersion === 0 ? defaultPolicy(row.key as SettingKey) : bases.find((setting) => setting.key === row.key && setting.version === row.baseVersion)?.value ?? null })), meta: { page: query.page, pageSize: query.pageSize, total } }
  }

  async propose(userId: string, entityId: string, key: SettingKey, baseVersion: number, input: unknown, submissionKey: string | undefined) {
    await this.access.requireEntityPermission(userId, entityId, 'settings.write')
    if (!submissionKey || submissionKey.length > 200 || !/^[\x21-\x7e]+$/.test(submissionKey)) throw new BadRequestException('A valid Idempotency-Key is required')
    const body = parseInput(proposalSchema, input)
    const value = parsePolicy(key, body.value)
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${entityId + ':policy-request:' + userId + ':' + submissionKey}, 0))`)
      const [replay] = await tx.select().from(policyChangeRequests).where(and(eq(policyChangeRequests.entityId, entityId), eq(policyChangeRequests.requestedBy, userId), eq(policyChangeRequests.submissionKey, submissionKey)))
      if (replay) {
        // JSONB key order differs from insertion order; compare via PostgreSQL equality.
        const [{ equal }] = (await tx.execute<{ equal: boolean }>(sql`SELECT proposed_value = ${JSON.stringify(value)}::jsonb AS equal FROM policy_change_requests WHERE id = ${replay.id}::uuid`)).rows
        if (replay.key !== key || replay.baseVersion !== baseVersion || replay.reason !== body.reason || !equal) throw new ConflictException('Idempotency key has a different payload')
        return { data: replay }
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${entityId + ':' + key}, 0))`)
      const existing = await currentSetting(tx, entityId, key)
      if ((existing?.version ?? 0) !== baseVersion) throw new ConflictException('Setting version changed; reload the active policy before requesting approval')
      const [request] = await tx.insert(policyChangeRequests).values({ entityId, key, baseVersion, proposedValue: value, reason: body.reason, requestedBy: userId, submissionKey }).returning()
      await effect(tx, request, userId, 'POLICY_CHANGE_REQUESTED')
      return { data: request }
    })
  }

  async decide(userId: string, id: string, decision: Decision, reason: string) {
    const [scope] = await this.database.db.select().from(policyChangeRequests).where(eq(policyChangeRequests.id, id))
    if (!scope) throw new NotFoundException('Policy change request not found')
    const grants = await this.access.getUserAccess(userId)
    const entity = grants.find((entity) => entity.id === scope.entityId && entity.permissions.includes('settings.read'))
    if (!entity) throw new NotFoundException('Policy change request not found')
    const permission = decision === 'CANCELLED' ? 'settings.write' : approvalPermission(scope.key as SettingKey)
    if (!entity.permissions.includes(permission)) throw new ForbiddenException('Policy decision permission is required for this entity and policy type')
    if (decision === 'CANCELLED' ? scope.requestedBy !== userId : scope.requestedBy === userId) {
      throw new ForbiddenException(decision === 'CANCELLED' ? 'Only the requester can cancel this request' : 'The requester cannot approve or reject their own policy change')
    }
    return this.database.db.transaction(async (tx) => {
      // One shared policy lock orders competing approvals before the request row lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.entityId + ':' + scope.key}, 0))`)
      const [request] = await tx.select().from(policyChangeRequests).where(eq(policyChangeRequests.id, id)).for('update')
      if (request.status !== 'PENDING') {
        if (request.status === decision && request.decidedBy === userId && request.decisionReason === reason) return { data: request }
        throw new ConflictException('Policy change request already has a final decision')
      }
      let approvedVersion: number | null = null
      let value: Record<string, unknown> | null = null
      if (decision === 'APPROVED') {
        const requester = (await this.access.getUserAccess(request.requestedBy)).find((entity) => entity.id === request.entityId)
        if (!requester?.permissions.includes('settings.write')) throw new ConflictException('Requester no longer has permission to change this entity policy')
        const existing = await currentSetting(tx, request.entityId, request.key)
        if ((existing?.version ?? 0) !== request.baseVersion) throw new ConflictException('Approval request is stale; cancel or reject it and submit against the active version')
        value = parsePolicy(request.key as SettingKey, request.proposedValue)
        approvedVersion = request.baseVersion + 1
      }
      const [updated] = await tx.update(policyChangeRequests).set({ status: decision, decidedBy: userId, decisionReason: reason, decidedAt: sql`clock_timestamp()`, approvedVersion }).where(eq(policyChangeRequests.id, id)).returning()
      if (approvedVersion !== null && value) await tx.insert(settings).values({ entityId: request.entityId, key: request.key, version: approvedVersion, value, updatedBy: userId, changeRequestId: request.id })
      await effect(tx, updated, userId, `POLICY_CHANGE_${decision}`)
      return { data: updated }
    })
  }
}
