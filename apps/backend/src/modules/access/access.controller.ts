import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { AccountManagementService, managedAccountInput } from './account-management.service.js'
import { AccessService } from './access.service.js'
import { EntityPermissionGuard, RequireEntityPermission, type EntityScopedRequest } from './entity-permission.guard.js'

@Controller('entities')
@UseGuards(AuthSessionGuard)
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly accounts: AccountManagementService,
  ) {}

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

  @Get(':entityId/presales')
  @UseGuards(EntityPermissionGuard)
  @RequireEntityPermission('bookings.create')
  async presales(@Param('entityId') entityId: string) {
    return { data: await this.access.findPresalesUsers(entityId) }
  }

  @Post(':entityId/accounts')
  @UseGuards(EntityPermissionGuard)
  @RequireEntityPermission('accounts.manage')
  async createAccount(
    @Req() request: EntityScopedRequest,
    @Param('entityId') entityId: string,
    @Body() body: unknown,
  ) {
    const id = parseInput(z.uuid(), entityId)
    const input = parseInput(managedAccountInput, body)
    return { data: await this.accounts.create(id, request.authSession.user.id, input) }
  }
}
