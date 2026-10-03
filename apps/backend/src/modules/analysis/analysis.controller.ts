import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { analysisSchema } from './analysis.dto.js'
import { AnalysisService } from './analysis.service.js'
@Controller('analysis')
@UseGuards(AuthSessionGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}
  @Post()
  @HttpCode(200)
  async analyze(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return { data: await this.analysis.analyze(req.authSession.user.id, parseInput(analysisSchema, body)) } }
  @Get()
  history(@Req() req: AuthenticatedRequest,@Query() query: unknown) {
    const input = parseInput(entityPageSchema,query)
    return this.analysis.history(req.authSession.user.id,input.entityId,input.page,input.pageSize)
  }
}
