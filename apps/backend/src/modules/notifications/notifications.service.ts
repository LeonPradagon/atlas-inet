import { Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import { notifications, outboxEvents } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'

@Injectable()
export class NotificationsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}
  async list(userId: string, entityId: string, page: number, pageSize: number) {
    await this.access.requireEntityPermission(userId, entityId, 'notifications.read')
    const where = and(eq(notifications.recipientId, userId), eq(notifications.entityId, entityId))
    const data = await this.database.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(pageSize).offset((page - 1) * pageSize)
    const [{ total }] = await this.database.db.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where)
    return { data, meta: { page, pageSize, total } }
  }
  async markRead(userId: string, id: string) {
    const [record] = await this.database.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)))
    if (!record) throw new NotFoundException('Notification not found')
    await this.access.requireEntityPermission(userId, record.entityId, 'notifications.read')
    const [updated] = await this.database.db.update(notifications).set({ readAt: sql`COALESCE(read_at, clock_timestamp())` }).where(eq(notifications.id, id)).returning()
    return { data: updated }
  }
  async deliverBatch() {
    return this.database.db.transaction(async (tx) => {
      const pending = await tx.select().from(outboxEvents).where(sql`${outboxEvents.deliveredAt} IS NULL`).orderBy(outboxEvents.createdAt).limit(50).for('update', { skipLocked: true })
      for (const event of pending) {
        const recipients = await tx.execute<{ userId: string }>(sql`SELECT DISTINCT m.user_id AS "userId" FROM memberships m
          JOIN entities e ON e.id = m.entity_id AND e.active JOIN membership_roles mr ON mr.membership_id = m.id
          JOIN roles r ON r.id = mr.role_id AND r.active JOIN role_permissions rp ON rp.role_id = r.id
          WHERE m.active AND m.entity_id = ${event.entityId}::uuid AND (rp.permission_code = 'notifications.receive'
            OR (m.user_id = ${String(event.payload.presalesUserId ?? event.payload.recipientUserId ?? '')} AND rp.permission_code = 'notifications.read')
            OR (${event.type === 'POLICY_CHANGE_REQUESTED'} AND rp.permission_code = ${String(event.payload.approvalPermission ?? '')}))`)
        for (const recipient of recipients.rows) await tx.insert(notifications).values({ eventId: event.id, entityId: event.entityId, recipientId: recipient.userId, type: event.type, payload: event.payload }).onConflictDoNothing()
        await tx.update(outboxEvents).set({ deliveredAt: sql`clock_timestamp()` }).where(eq(outboxEvents.id, event.id))
      }
      return pending.length
    })
  }
}
