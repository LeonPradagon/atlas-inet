import { Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
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
  async unreadCount(userId: string, entityId: string) {
    await this.access.requireEntityPermission(userId, entityId, 'notifications.read')
    const [{ count }] = await this.database.db.select({ count: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.recipientId, userId), eq(notifications.entityId, entityId), isNull(notifications.readAt)))
    return { data: count }
  }
  async markRead(userId: string, id: string) {
    const [record] = await this.database.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)))
    if (!record) throw new NotFoundException('Notification not found')
    await this.access.requireEntityPermission(userId, record.entityId, 'notifications.read')
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx.update(notifications).set({ readAt: sql`clock_timestamp()` })
        .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId), isNull(notifications.readAt))).returning()
      if (updated) await tx.execute(sql`SELECT pg_notify('atlas_notifications', ${JSON.stringify({
        type: 'notification.read', recipientUserId: userId, entityId: updated.entityId, notificationId: updated.id, notificationType: updated.type,
      })})`)
      if (updated) return { data: updated }
      const [current] = await tx.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)))
      if (!current) throw new NotFoundException('Notification not found')
      return { data: current }
    })
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
        for (const recipient of recipients.rows) {
          const [notification] = await tx.insert(notifications).values({ eventId: event.id, entityId: event.entityId, recipientId: recipient.userId, type: event.type, payload: event.payload }).onConflictDoNothing().returning({ id: notifications.id })
          if (notification) await tx.execute(sql`SELECT pg_notify('atlas_notifications', ${JSON.stringify({
            type: 'notification.created', recipientUserId: recipient.userId, entityId: event.entityId, notificationId: notification.id, notificationType: event.type,
          })})`)
        }
        await tx.update(outboxEvents).set({ deliveredAt: sql`clock_timestamp()` }).where(eq(outboxEvents.id, event.id))
      }
      return pending.length
    })
  }
}
