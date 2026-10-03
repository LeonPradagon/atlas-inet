import { BadRequestException, Injectable, SetMetadata } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { z } from 'zod'
import type { AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { AccessService } from './access.service.js'
import type { EntityAccess } from './access.repository.js'

const ENTITY_PERMISSION = 'atlas:entity-permission'
export const RequireEntityPermission = (permission: string) => SetMetadata(ENTITY_PERMISSION, permission)
export type EntityScopedRequest = AuthenticatedRequest & { entityAccess: EntityAccess }

@Injectable()
export class EntityPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string>(ENTITY_PERMISSION, [context.getHandler(), context.getClass()])
    // Missing policy never grants access accidentally.
    if (!permission) return false
    const request = context.switchToHttp().getRequest<EntityScopedRequest>()
    const entityId = z.uuid().safeParse(request.params.entityId)
    if (!entityId.success) throw new BadRequestException('A valid entityId is required')
    request.entityAccess = await this.access.requireEntityPermission(request.authSession.user.id, entityId.data, permission)
    return true
  }
}
