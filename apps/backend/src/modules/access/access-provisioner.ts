import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import * as schema from '../../database/schema/index.js'

export const accessGrantInput = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  entityCode: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,63}$/),
  entityName: z.string().trim().min(1).max(200),
  roleCode: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  permissions: z.array(z.string().regex(/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/)).min(1)
    .transform((values) => [...new Set(values)].sort()),
  source: z.string().min(1).max(200),
}).strict()

export type AccessGrantInput = z.input<typeof accessGrantInput>

// Local operator provisioning only. No public bootstrap endpoint or implicit Admin role.
export class AccessProvisioner {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async grant(input: AccessGrantInput) {
    const data = accessGrantInput.parse(input)
    return this.db.transaction(async (tx) => {
      // Serialize bootstrap changes, including concurrent creation of the same role.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1415135332)`)
      const [subject] = await tx.select().from(schema.user).where(eq(schema.user.email, data.email))
      if (!subject) throw new Error('Create the account before assigning access')

      let [entity] = await tx.select().from(schema.entities).where(eq(schema.entities.code, data.entityCode))
      if (entity && (!entity.active || entity.name !== data.entityName)) {
        throw new Error('Existing entity is inactive or has a different name; no changes made')
      }
      if (!entity) [entity] = await tx.insert(schema.entities).values({ code: data.entityCode, name: data.entityName }).returning()

      let [role] = await tx.select().from(schema.roles)
        .where(and(eq(schema.roles.entityId, entity.id), eq(schema.roles.code, data.roleCode)))
      if (role) {
        const existing = await tx.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id))
        const codes = existing.map((item) => item.permissionCode).sort()
        if (!role.active || JSON.stringify(codes) !== JSON.stringify(data.permissions)) {
          throw new Error('Existing role is inactive or has different permissions; use a new role code')
        }
      } else {
        [role] = await tx.insert(schema.roles).values({ entityId: entity.id, code: data.roleCode }).returning()
        await tx.insert(schema.permissions).values(data.permissions.map((code) => ({ code }))).onConflictDoNothing()
        await tx.insert(schema.rolePermissions).values(data.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })))
      }

      let [membership] = await tx.select().from(schema.memberships)
        .where(and(eq(schema.memberships.userId, subject.id), eq(schema.memberships.entityId, entity.id)))
      if (membership && !membership.active) throw new Error('Membership is inactive; no changes made')
      if (!membership) [membership] = await tx.insert(schema.memberships).values({ userId: subject.id, entityId: entity.id }).returning()

      const inserted = await tx.insert(schema.membershipRoles)
        .values({ membershipId: membership.id, roleId: role.id, entityId: entity.id }).onConflictDoNothing().returning()
      if (inserted.length) {
        await tx.insert(schema.accessAudit).values({
          entityId: entity.id, subjectUserId: subject.id, action: 'ROLE_GRANTED', source: data.source,
          details: { roleId: role.id, roleCode: role.code, permissions: data.permissions },
        })
      }
      return { entityId: entity.id, membershipId: membership.id, roleId: role.id, changed: inserted.length > 0 }
    })
  }

  async revoke(input: { email: string; entityCode: string; roleCode: string; source: string }) {
    const data = accessGrantInput.omit({ entityName: true, permissions: true }).parse(input)
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1415135332)`)
      const [grant] = await tx.select({ membershipId: schema.memberships.id, roleId: schema.roles.id, entityId: schema.entities.id, userId: schema.user.id })
        .from(schema.membershipRoles)
        .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipRoles.membershipId))
        .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
        .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
        .innerJoin(schema.entities, eq(schema.entities.id, schema.memberships.entityId))
        .where(and(eq(schema.user.email, data.email), eq(schema.entities.code, data.entityCode), eq(schema.roles.code, data.roleCode)))
      if (!grant) return { changed: false }
      await tx.delete(schema.membershipRoles).where(and(
        eq(schema.membershipRoles.membershipId, grant.membershipId), eq(schema.membershipRoles.roleId, grant.roleId),
      ))
      await tx.insert(schema.accessAudit).values({
        entityId: grant.entityId, subjectUserId: grant.userId, action: 'ROLE_REVOKED', source: data.source,
        details: { roleId: grant.roleId, roleCode: data.roleCode },
      })
      return { changed: true }
    })
  }
}
