import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { allocations, auditLogs, bookings, idempotencyRecords, memberships, networkSegments, outboxEvents, waitingList } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { currentSetting, bookingPolicySchema } from '../settings/settings.service.js'
import { CapacityRepository, readUsage, type Segment } from './capacity.repository.js'
import type { CreateBooking, ExistingUsageInput } from './capacity.dto.js'

async function effect(tx: Transaction, segment: Segment, actorId: string, action: string, resourceId: string, details: Record<string, unknown>, notify = false) {
  await tx.insert(auditLogs).values({ entityId: segment.ownerEntityId, actorId, action, resourceId, details })
  if (notify) await tx.insert(outboxEvents).values({ entityId: segment.ownerEntityId, type: action, payload: { segmentId: segment.id, resourceId, ...details } })
}

@Injectable()
export class CapacityService {
  constructor(private readonly database: DatabaseService, private readonly repository: CapacityRepository, private readonly access: AccessService) {}

  private async replay(tx: Transaction, userId: string, action: string, key: string | undefined, input: unknown) {
    if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new BadRequestException('A valid Idempotency-Key is required')
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ':' + action + ':' + key}, 0))`)
    const [record] = await tx.select().from(idempotencyRecords).where(and(eq(idempotencyRecords.userId, userId), eq(idempotencyRecords.action, action), eq(idempotencyRecords.key, key)))
    if (record && record.payloadHash !== hash) throw new ConflictException('Idempotency key has a different payload')
    return { hash, key, existing: record?.response }
  }

  private async head(tx: Transaction, segmentId: string) {
    const [head] = await tx.select().from(waitingList).where(and(eq(waitingList.segmentId, segmentId), eq(waitingList.status, 'WAITING'))).orderBy(asc(waitingList.createdAt), asc(waitingList.id)).limit(1)
    return head
  }

  private async notifyWaiting(tx: Transaction, segment: Segment) {
    const head = await this.head(tx, segment.id)
    const usage = await readUsage(tx, segment)
    if (head && usage.available !== null && head.coreCount <= usage.available) {
      await tx.insert(outboxEvents).values({ entityId: segment.ownerEntityId, type: 'WAITLIST_CAPACITY_AVAILABLE', payload: { segmentId: segment.id, resourceId: head.id, presalesUserId: head.presalesUserId, coreCount: head.coreCount, available: usage.available } })
    }
  }

  async expireLocked(tx: Transaction, segment: Segment) {
    const expired = await tx.update(bookings).set({ status: 'EXPIRED', closedAt: sql`clock_timestamp()`, closedReason: 'Expiry' })
      .where(and(eq(bookings.segmentId, segment.id), eq(bookings.status, 'BOOKED'), lte(bookings.expiresAt, sql`clock_timestamp()`))).returning()
    for (const booking of expired) await effect(tx, segment, 'worker', 'BOOKING_EXPIRED', booking.id, { coreCount: booking.coreCount, presalesUserId: booking.presalesUserId }, true)
    if (expired.length) await this.notifyWaiting(tx, segment)
  }

  private async insertBooking(tx: Transaction, segment: Segment, input: CreateBooking, userId: string) {
    if (segment.status !== 'ACTIVE' || !segment.capacityValidated || segment.installedCoreCount === null) throw new UnprocessableEntityException('Segment capacity is not eligible for booking')
    const [pic] = await tx.select().from(memberships).where(and(eq(memberships.userId, input.presalesUserId), eq(memberships.entityId, segment.ownerEntityId), eq(memberships.active, true)))
    if (!pic) throw new UnprocessableEntityException('Presales PIC must have an active entity membership')
    const usage = await readUsage(tx, segment)
    if (usage.available === null || usage.available < input.coreCount) throw new ConflictException('Insufficient available core')
    const setting = await currentSetting(tx, segment.ownerEntityId, 'booking-policy')
    const policy = bookingPolicySchema.parse(setting?.value ?? { duration: 1, unit: 'MONTH' })
    const interval = policy.unit === 'MONTH' ? sql`make_interval(months => ${policy.duration})` : sql`make_interval(days => ${policy.duration})`
    const [record] = await tx.insert(bookings).values({
      customerName: input.customerName, customerReference: input.customerReference, customerPicName: input.customerPicName,
      customerPicContact: input.customerPicContact, presalesUserId: input.presalesUserId, coreCount: input.coreCount, reason: input.reason,
      segmentId: segment.id, entityId: segment.ownerEntityId, createdBy: userId,
      createdAt: sql`clock_timestamp()`, policyVersion: setting?.version ?? 0,
      expiresAt: sql`((clock_timestamp() AT TIME ZONE 'Asia/Jakarta') + ${interval}) AT TIME ZONE 'Asia/Jakarta'`,
    }).returning()
    await effect(tx, segment, userId, 'BOOKING_CREATED', record.id, { coreCount: record.coreCount, policyVersion: record.policyVersion })
    return record
  }

  async create(userId: string, input: CreateBooking, key: string | undefined, waiting = false) {
    const permission = waiting ? 'waiting-list.create' : 'bookings.create'
    const scope = await this.repository.authorizeSegment(userId, input.segmentId, permission)
    await this.access.requireEntityPermission(input.presalesUserId, scope.entityId, 'bookings.create')
    return this.database.db.transaction(async (tx) => {
      const action = waiting ? 'WAITING_CREATE' : 'BOOKING_CREATE'
      const replay = await this.replay(tx, userId, action, key, input)
      if (replay.existing) return { data: replay.existing }
      const segment = await this.repository.lock(tx, input.segmentId)
      await this.expireLocked(tx, segment)
      let record: Record<string, unknown>
      if (waiting) {
        if (segment.status !== 'ACTIVE') throw new ConflictException('Segment is inactive')
        const [row] = await tx.insert(waitingList).values({ ...input, entityId: segment.ownerEntityId, createdBy: userId, createdAt: sql`clock_timestamp()` }).returning()
        await effect(tx, segment, userId, 'WAITLIST_CREATED', row.id, { coreCount: row.coreCount })
        record = row
      } else {
        if (await this.head(tx, segment.id)) throw new ConflictException('Active waiting list has priority')
        record = await this.insertBooking(tx, segment, input, userId)
      }
      await tx.insert(idempotencyRecords).values({ userId, action, key: replay.key, payloadHash: replay.hash, response: record })
      return { data: record }
    })
  }

  async changeBooking(userId: string, id: string, action: 'release' | 'activate', value: string) {
    const [existing] = await this.database.db.select().from(bookings).where(eq(bookings.id, id))
    if (!existing) throw new NotFoundException('Booking not found')
    await this.repository.authorizeSegment(userId, existing.segmentId, action === 'release' ? 'bookings.release' : 'allocations.write','Booking not found')
    return this.database.db.transaction(async (tx) => {
      const segment = await this.repository.lock(tx, existing.segmentId)
      await this.expireLocked(tx, segment)
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id))
      if (action === 'release' && booking.status === 'RELEASED') return { data: booking }
      if (action === 'activate' && booking.status === 'USED') {
        const [allocation] = await tx.select().from(allocations).where(eq(allocations.sourceBookingId, id))
        if (allocation.operationalReference !== value) throw new ConflictException('Activation already has a different operational reference')
        return { data: allocation }
      }
      if (booking.status !== 'BOOKED') throw new ConflictException('Booking is no longer active')
      if (action === 'activate' && segment.status !== 'ACTIVE') throw new ConflictException('Segment is inactive')
      const [closed] = await tx.update(bookings).set({ status: action === 'release' ? 'RELEASED' : 'USED', closedAt: sql`clock_timestamp()`, closedReason: value }).where(and(eq(bookings.id, id), sql`${bookings.expiresAt} > clock_timestamp()`)).returning()
      if (!closed) throw new ConflictException('Booking has expired')
      let record: Record<string, unknown> = closed
      if (action === 'activate') {
        const [allocation] = await tx.insert(allocations).values({ entityId: booking.entityId, segmentId: booking.segmentId, sourceBookingId: booking.id, coreCount: booking.coreCount, operationalReference: value, activatedBy: userId }).returning()
        record = allocation
      }
      await effect(tx, segment, userId, action === 'release' ? 'BOOKING_RELEASED' : 'BOOKING_ACTIVATED', id, { coreCount: booking.coreCount, presalesUserId: booking.presalesUserId, reason: value }, action === 'release')
      if (action === 'release') await this.notifyWaiting(tx, segment)
      return { data: record }
    })
  }

  async changeWaiting(userId: string, id: string, action: 'allocate' | 'cancel', reason: string, key?: string) {
    const [existing] = await this.database.db.select().from(waitingList).where(eq(waitingList.id, id))
    if (!existing) throw new NotFoundException('Waiting request not found')
    await this.repository.authorizeSegment(userId, existing.segmentId, action === 'allocate' ? 'waiting-list.allocate' : 'waiting-list.cancel','Waiting request not found')
    if (action === 'allocate' && existing.status === 'WAITING') await this.access.requireEntityPermission(existing.presalesUserId, existing.entityId, 'bookings.create')
    return this.database.db.transaction(async (tx) => {
      const replay = action === 'allocate' ? await this.replay(tx, userId, 'WAITING_ALLOCATE', key, { id }) : null
      if (replay?.existing) return { data: replay.existing }
      const segment = await this.repository.lock(tx, existing.segmentId)
      await this.expireLocked(tx, segment)
      const [entry] = await tx.select().from(waitingList).where(eq(waitingList.id, id))
      if (action === 'cancel') {
        if (entry.status === 'CANCELLED') return { data: entry }
        if (entry.status !== 'WAITING') throw new ConflictException('Request is not waiting')
        const [cancelled] = await tx.update(waitingList).set({ status: 'CANCELLED', closedAt: sql`clock_timestamp()`, closedReason: reason }).where(eq(waitingList.id, id)).returning()
        await effect(tx, segment, userId, 'WAITLIST_CANCELLED', id, { reason })
        await this.notifyWaiting(tx, segment)
        return { data: cancelled }
      }
      let booking: typeof bookings.$inferSelect
      if (entry.status === 'ALLOCATED') {
        ;[booking] = await tx.select().from(bookings).where(eq(bookings.id, entry.bookingId!))
      } else {
        if (entry.status !== 'WAITING' || (await this.head(tx, segment.id))?.id !== entry.id) throw new ConflictException('FIFO head must be allocated first')
        booking = await this.insertBooking(tx, segment, entry, userId)
        await tx.update(waitingList).set({ status: 'ALLOCATED', bookingId: booking.id, closedAt: sql`clock_timestamp()` }).where(eq(waitingList.id, id))
        await effect(tx, segment, userId, 'WAITLIST_ALLOCATED', id, { bookingId: booking.id, presalesUserId: entry.presalesUserId, coreCount: entry.coreCount }, true)
      }
      await tx.insert(idempotencyRecords).values({ userId, action: 'WAITING_ALLOCATE', key: replay!.key, payloadHash: replay!.hash, response: booking })
      return { data: booking }
    })
  }

  async deallocate(userId: string, id: string, reason: string) {
    const [existing] = await this.database.db.select().from(allocations).where(eq(allocations.id, id))
    if (!existing) throw new NotFoundException('Allocation not found')
    await this.repository.authorizeSegment(userId, existing.segmentId, 'allocations.write','Allocation not found')
    return this.database.db.transaction(async (tx) => {
      const segment = await this.repository.lock(tx, existing.segmentId)
      await this.expireLocked(tx, segment)
      const [record] = await tx.update(allocations).set({ deallocatedAt: sql`clock_timestamp()`, deallocatedBy: userId, deallocationReason: reason }).where(and(eq(allocations.id, id), isNull(allocations.deallocatedAt))).returning()
      if (!record) return { data: (await tx.select().from(allocations).where(eq(allocations.id, id)))[0] }
      await effect(tx, segment, userId, 'ALLOCATION_DEALLOCATED', id, { reason, coreCount: record.coreCount }, true)
      await this.notifyWaiting(tx, segment)
      return { data: record }
    })
  }

  async usage(userId: string, segmentId: string) {
    await this.repository.authorizeSegment(userId, segmentId, 'network.read')
    const [segment] = await this.database.db.select().from(networkSegments).where(eq(networkSegments.id, segmentId))
    return { data: await readUsage(this.database.db, segment) }
  }
  async recordExistingUsage(userId: string, id: string, version: number, input: ExistingUsageInput, key?: string) {
    const scope = await this.repository.authorizeSegment(userId, id, 'network.write')
    await this.access.requireEntityPermission(userId, scope.entityId, 'allocations.write')
    return this.database.db.transaction(async (tx) => {
      const replay = await this.replay(tx, userId, 'EXISTING_USAGE_RECORD', key, { id, version, ...input })
      if (replay.existing) return { data: replay.existing }
      const segment = await this.repository.lock(tx, id)
      if (segment.version !== version) throw new ConflictException('Segment version changed; reload before recording existing usage')
      if (segment.status !== 'ACTIVE') throw new ConflictException('Segment is inactive')
      const [baseline] = await tx.select({ id: allocations.id }).from(allocations).where(and(eq(allocations.segmentId, id), isNull(allocations.sourceBookingId), isNull(allocations.deallocatedAt))).limit(1)
      if (baseline) throw new ConflictException('Existing usage is already recorded; close the existing allocation with a reason before correcting it')
      await this.expireLocked(tx, segment)
      const usage = await readUsage(tx, segment)
      if (usage.used + usage.booked + input.existingCoreCount > input.installedCoreCount) throw new ConflictException('Total core cannot be less than recorded Used + active Booked + unrecorded existing usage')
      const [updated] = await tx.update(networkSegments).set({ installedCoreCount: input.installedCoreCount, capacityValidated: true, version: segment.version + 1, updatedAt: sql`clock_timestamp()` }).where(eq(networkSegments.id, id)).returning()
      let allocationId: string | null = null
      if (input.existingCoreCount > 0) {
        const [record] = await tx.insert(allocations).values({ entityId: segment.ownerEntityId, segmentId: id, sourceBookingId: null, coreCount: input.existingCoreCount, operationalReference: input.operationalReference, activatedBy: userId }).returning()
        allocationId = record.id
      }
      const response = { id, version: updated.version, allocationId, capacity: await readUsage(tx, updated) }
      await effect(tx, updated, userId, 'EXISTING_USAGE_RECORDED', id, { allocationId, installedCoreCount: input.installedCoreCount, existingCoreCount: input.existingCoreCount, operationalReference: input.operationalReference, reason: input.reason, version: updated.version })
      await tx.insert(idempotencyRecords).values({ userId, action: 'EXISTING_USAGE_RECORD', key: replay.key, payloadHash: replay.hash, response })
      return { data: response }
    })
  }
  async activeAllocations(userId: string, id: string, page: number, pageSize: number) {
    await this.repository.authorizeSegment(userId, id, 'network.read')
    const where = and(eq(allocations.segmentId, id), isNull(allocations.deallocatedAt))
    const data = await this.database.db.select().from(allocations).where(where).orderBy(asc(allocations.activatedAt), asc(allocations.id)).limit(pageSize).offset((page - 1) * pageSize)
    const [{ total }] = await this.database.db.select({ total: sql<number>`count(*)::int` }).from(allocations).where(where)
    return { data, meta: { page, pageSize, total } }
  }

  async list(userId: string, entityId: string, page: number, pageSize: number, waiting = false,segmentId?: string,status?: string) {
    await this.access.requireEntityPermission(userId, entityId, waiting ? 'waiting-list.read' : 'bookings.read')
    const table = waiting ? waitingList : bookings
    const where = and(eq(table.entityId,entityId),segmentId ? eq(table.segmentId,segmentId) : undefined,status ? eq(table.status,status) : undefined)
    const data = await this.database.db.select().from(table).where(where).orderBy(asc(table.createdAt), asc(table.id)).limit(pageSize).offset((page - 1) * pageSize)
    const [{ total }] = await this.database.db.select({ total: sql<number>`count(*)::int` }).from(table).where(where)
    return { data, meta: { page, pageSize, total } }
  }

  async expireBatch() {
    const rows = await this.database.db.selectDistinct({ segmentId: bookings.segmentId }).from(bookings).where(and(eq(bookings.status, 'BOOKED'), lte(bookings.expiresAt, sql`clock_timestamp()`))).limit(100)
    for (const row of rows) await this.database.db.transaction(async (tx) => this.expireLocked(tx, await this.repository.lock(tx, row.segmentId)))
    return rows.length
  }
}
