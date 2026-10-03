import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { parseInput, reasonSchema, requireVersion } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { SettingsService } from './settings.service.js'
import { PolicyRequestsService, policyRequestsQuery } from './policy-requests.service.js'
import { settingKeySchema } from './policy-input.js'

@Controller('settings')
@UseGuards(AuthSessionGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly requests: PolicyRequestsService) {}
  @Get('requests')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.requests.list(req.authSession.user.id, parseInput(policyRequestsQuery, query))
  }
  @Post(':key/requests')
  @HttpCode(202)
  propose(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Query('entityId') entityId: string, @Headers('if-match') version: string | undefined, @Headers('idempotency-key') submissionKey: string | undefined, @Body() body: unknown) {
    return this.requests.propose(req.authSession.user.id, parseInput(z.uuid(), entityId), parseInput(settingKeySchema, key), requireVersion(version), body, submissionKey)
  }
  @Post('requests/:id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.decide(req.authSession.user.id, parseInput(z.uuid(), id), 'APPROVED', parseInput(reasonSchema, body).reason)
  }
  @Post('requests/:id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.decide(req.authSession.user.id, parseInput(z.uuid(), id), 'REJECTED', parseInput(reasonSchema, body).reason)
  }
  @Post('requests/:id/cancel')
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.decide(req.authSession.user.id, parseInput(z.uuid(), id), 'CANCELLED', parseInput(reasonSchema, body).reason)
  }
  @Get(':key')
  get(@Req() req: AuthenticatedRequest, @Query('entityId') entityId: string, @Param('key') key: string) {
    return this.settings.get(req.authSession.user.id, parseInput(z.uuid(), entityId), parseInput(settingKeySchema, key))
  }
  @Patch(':key')
  update(@Req() req: AuthenticatedRequest, @Query('entityId') entityId: string, @Param('key') key: string) {
    parseInput(settingKeySchema, key)
    return this.settings.update(req.authSession.user.id, parseInput(z.uuid(), entityId))
  }
}
