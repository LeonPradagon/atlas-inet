import { ConflictException, Injectable } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { settings } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { defaultPolicy, type SettingKey } from './policy-input.js'
// Preserve the existing imports used by capacity/analysis/import readers.
export { bookingPolicySchema, namingPolicySchema, analysisPolicySchema } from './policy-input.js'
export type { SettingKey, BookingPolicy } from './policy-input.js'

export async function currentSetting(tx: Transaction | DatabaseService['db'], entityId: string, key: string) {
  const [record] = await tx.select().from(settings).where(and(eq(settings.entityId, entityId), eq(settings.key, key))).orderBy(desc(settings.version)).limit(1)
  return record ?? null
}

@Injectable()
export class SettingsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}

  async get(userId: string, entityId: string, key: SettingKey) {
    await this.access.requireEntityPermission(userId, entityId, 'settings.read')
    const record = await currentSetting(this.database.db, entityId, key)
    return { data: record ?? { entityId, key, version: 0, value: defaultPolicy(key) } }
  }

  async update(userId: string, entityId: string) {
    await this.access.requireEntityPermission(userId, entityId, 'settings.write')
    throw new ConflictException('Direct policy updates are disabled; submit a policy change request for independent approval')
  }
}
