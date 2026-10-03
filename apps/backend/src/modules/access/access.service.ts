import { ForbiddenException, Injectable } from '@nestjs/common'
import { AccessRepository } from './access.repository.js'

@Injectable()
export class AccessService {
  constructor(private readonly repository: AccessRepository) {}

  getUserAccess(userId: string) {
    return this.repository.findUserAccess(userId)
  }

  async requireEntityPermission(userId: string, entityId: string, permission: string) {
    const access = await this.getUserAccess(userId)
    const entity = access.find((item) => item.id === entityId && item.permissions.includes(permission))
    if (!entity) throw new ForbiddenException('Permission is required for this entity')
    return entity
  }
}
