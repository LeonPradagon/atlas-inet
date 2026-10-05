import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { mapQuerySchema, networkSearchQuerySchema, parseNetworkInput, segmentsQuerySchema } from './network.dto.js'
import { NetworkService } from './network.service.js'

@Controller('network')
@UseGuards(AuthSessionGuard)
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @Get('segments')
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.network.listSegments(request.authSession.user.id, parseNetworkInput(segmentsQuerySchema, query))
  }

  @Get('segments/:id')
  detail(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.network.getSegment(request.authSession.user.id, parseNetworkInput(z.uuid(), id))
  }

  @Get('map')
  map(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.network.getMap(request.authSession.user.id, parseNetworkInput(mapQuerySchema, query))
  }

  @Get('search')
  search(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.network.search(request.authSession.user.id, parseNetworkInput(networkSearchQuerySchema, query))
  }
}
