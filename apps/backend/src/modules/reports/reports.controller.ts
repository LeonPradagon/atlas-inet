import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { ReportsService } from './reports.service.js'
@Controller('reports')
@UseGuards(AuthSessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('utilization')
  get(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const input = parseInput(entityPageSchema, query)
    return this.reports.get(req.authSession.user.id, input.entityId, input.page, input.pageSize)
  }
}
