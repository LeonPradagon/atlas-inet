import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DatabaseService } from '../../database/database.service.js'
import * as schema from '../../database/schema/index.js'
import { AuthService } from '../auth/auth.service.js'
import { AccessProvisioner } from './access-provisioner.js'

export const managedAccountInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  profile: z.enum(['booking-user', 'booking-manager']),
}).strict()

export type ManagedAccountInput = z.infer<typeof managedAccountInput>

const bookingPermissions = ['entities.read', 'network.read', 'bookings.create', 'bookings.read'] as const
const profilePermissions = {
  'booking-user': bookingPermissions,
  'booking-manager': [...bookingPermissions, 'bookings.release', 'allocations.write'],
} as const

@Injectable()
export class AccountManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  async create(entityId: string, actorUserId: string, input: ManagedAccountInput) {
    const data = managedAccountInput.parse(input)
    const [entity] = await this.database.db.select().from(schema.entities)
      .where(and(eq(schema.entities.id, entityId), eq(schema.entities.active, true)))
    if (!entity) throw new NotFoundException('Active entity not found')
    const [existingUser] = await this.database.db.select({ id: schema.user.id }).from(schema.user)
      .where(eq(schema.user.email, data.email))
    if (existingUser) throw new ConflictException('Email is already registered')

    const created = await this.auth.createUser({ email: data.email, name: data.name, password: data.password })
    try {
      await new AccessProvisioner(this.database.db).grant({
        email: data.email,
        entityCode: entity.code,
        entityName: entity.name,
        roleCode: data.profile,
        permissions: [...profilePermissions[data.profile]],
        source: `admin-ui:${actorUserId}`,
      })
    } catch (error) {
      // Avoid leaving an account without the requested entity-scoped access grant.
      await this.database.db.delete(schema.user).where(eq(schema.user.id, created.user.id))
      throw error
    }

    return { id: created.user.id, name: created.user.name, email: created.user.email, profile: data.profile }
  }
}
