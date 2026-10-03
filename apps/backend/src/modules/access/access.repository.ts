import { Injectable } from '@nestjs/common'
import { and, asc, eq } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import { entities, memberships, membershipRoles, roles, rolePermissions } from '../../database/schema/index.js'

export interface EntityAccess {
  id: string
  code: string
  name: string
  roles: string[]
  permissions: string[]
}

@Injectable()
export class AccessRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserAccess(userId: string): Promise<EntityAccess[]> {
    const rows = await this.database.db.select({
      id: entities.id,
      code: entities.code,
      name: entities.name,
      role: roles.code,
      permission: rolePermissions.permissionCode,
    }).from(memberships)
      .innerJoin(entities, and(eq(entities.id, memberships.entityId), eq(entities.active, true)))
      .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .leftJoin(roles, and(eq(roles.id, membershipRoles.roleId), eq(roles.active, true)))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
      .orderBy(asc(entities.code), asc(roles.code), asc(rolePermissions.permissionCode))

    const result = new Map<string, EntityAccess>()
    for (const row of rows) {
      let entity = result.get(row.id)
      if (!entity) {
        entity = { id: row.id, code: row.code, name: row.name, roles: [], permissions: [] }
        result.set(row.id, entity)
      }
      if (row.role && !entity.roles.includes(row.role)) entity.roles.push(row.role)
      if (row.permission && !entity.permissions.includes(row.permission)) entity.permissions.push(row.permission)
    }
    return [...result.values()].map((entity) => ({
      ...entity, roles: entity.roles.sort(), permissions: entity.permissions.sort(),
    }))
  }
}
