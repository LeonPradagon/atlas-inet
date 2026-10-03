import { Injectable, NotFoundException } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { networkSegments } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'

export type Segment = typeof networkSegments.$inferSelect
export interface Usage { total: number | null; used: number; booked: number; idle: number | null; available: number | null; waitingCount: number; waitingCores: number; asOf: string }

export async function readUsage(tx: Transaction | DatabaseService['db'], segment: Segment): Promise<Usage> {
  const result = await tx.execute<{ used: number; booked: number; waitingCount: number; waitingCores: number; asOf: string | Date }>(sql`
    SELECT (SELECT COALESCE(sum(core_count),0)::int FROM core_allocations WHERE segment_id = ${segment.id}::uuid AND deallocated_at IS NULL) AS used,
      (SELECT COALESCE(sum(core_count),0)::int FROM bookings WHERE segment_id = ${segment.id}::uuid AND status = 'BOOKED' AND expires_at > statement_timestamp()) AS booked,
      (SELECT count(*)::int FROM waiting_list_entries WHERE segment_id = ${segment.id}::uuid AND status = 'WAITING') AS "waitingCount",
      (SELECT COALESCE(sum(core_count),0)::float8 FROM waiting_list_entries WHERE segment_id = ${segment.id}::uuid AND status = 'WAITING') AS "waitingCores", statement_timestamp() AS "asOf"`)
  const row = result.rows[0]
  const total = segment.capacityValidated ? segment.installedCoreCount : null
  return { total, used: row.used, booked: row.booked, idle: total === null ? null : total - row.used, available: total === null ? null : total - row.used - row.booked, waitingCount: row.waitingCount, waitingCores: row.waitingCores, asOf: new Date(row.asOf).toISOString() }
}

@Injectable()
export class CapacityRepository {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}

  async authorizeSegment(userId: string, segmentId: string, permission: string,notFoundMessage = 'Segment not found') {
    const allowed = (await this.access.getUserAccess(userId)).filter((entity) => entity.permissions.includes(permission)).map((entity) => entity.id)
    if (!allowed.length) throw new NotFoundException(notFoundMessage)
    const result = await this.database.db.execute<{ id: string; entityId: string }>(sql`SELECT s.id, s.owner_entity_id AS "entityId" FROM network_segments s
      JOIN network_datasets d ON d.id = s.dataset_id WHERE s.id = ${segmentId}::uuid AND d.status = 'PUBLISHED'
      AND s.owner_entity_id = ANY(ARRAY[${sql.join(allowed.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`)
    if (!result.rows[0]) throw new NotFoundException(notFoundMessage)
    return result.rows[0]
  }

  async lock(tx: Transaction, segmentId: string) {
    const [segment] = await tx.select().from(networkSegments).where(eq(networkSegments.id, segmentId)).for('update')
    if (!segment) throw new NotFoundException('Segment not found')
    return segment
  }
}
