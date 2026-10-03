import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { entityPageSchema, parseInput, requireVersion } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { AssetsService } from './assets.service.js'
@Controller('network')
@UseGuards(AuthSessionGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}
  @Patch('segments/:id')
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Headers('if-match') version: string | undefined, @Body() body: unknown) {
    return this.assets.update(req.authSession.user.id, parseInput(z.uuid(), id), requireVersion(version), body)
  }
  @Get('segments/:id/name-history')
  history(@Req() req: AuthenticatedRequest,@Param('id') id: string,@Query() query: unknown) {
    const input = parseInput(entityPageSchema.omit({ entityId:true }),query)
    return this.assets.nameHistory(req.authSession.user.id,parseInput(z.uuid(),id),input.page,input.pageSize)
  }
  @Get('cable-types')
  types(@Req() req: AuthenticatedRequest,@Query() query: unknown) {
    const input = parseInput(entityPageSchema,query)
    return this.assets.types(req.authSession.user.id,input.entityId,input.page,input.pageSize)
  }
  @Post('cable-types')
  createType(@Req() req: AuthenticatedRequest,@Body() body: unknown) {
    const input = parseInput(z.object({ entityId:z.uuid(),code:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(200) }).strict(),body)
    return this.assets.createType(req.authSession.user.id,input.entityId,input.code,input.name)
  }
}
