import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { NotificationsService } from './notifications.service.js'
@Controller('notifications')
@UseGuards(AuthSessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const input = parseInput(entityPageSchema, query)
    return this.notifications.list(req.authSession.user.id, input.entityId, input.page, input.pageSize)
  }
  @Post(':id/read')
  read(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.notifications.markRead(req.authSession.user.id, parseInput(z.uuid(), id)) }
}
