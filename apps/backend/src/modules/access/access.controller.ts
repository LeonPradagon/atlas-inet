import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { AccessService } from './access.service.js'
import { EntityPermissionGuard, RequireEntityPermission, type EntityScopedRequest } from './entity-permission.guard.js'

@Controller('entities')
@UseGuards(AuthSessionGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().safeParse(query)
    if (!parsed.success) throw new BadRequestException('Invalid pagination; pageSize must be between 1 and 100')
    const { page, pageSize } = parsed.data
    const entities = await this.access.getUserAccess(request.authSession.user.id)
    const visible = entities.filter((entity) => entity.permissions.includes('entities.read'))
    return {
      data: visible.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: visible.length },
    }
  }

  @Get(':entityId')
  @UseGuards(EntityPermissionGuard)
  @RequireEntityPermission('entities.read')
  detail(@Req() request: EntityScopedRequest) {
    return { data: request.entityAccess }
  }
}
