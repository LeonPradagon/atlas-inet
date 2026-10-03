import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { parseInput, reasonSchema } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { activateSchema, bookingListSchema, createBookingSchema, waitingListSchema } from './capacity.dto.js'
import { CapacityService } from './capacity.service.js'

@Controller()
@UseGuards(AuthSessionGuard)
export class CapacityController {
  constructor(private readonly capacity: CapacityService) {}
  @Post('bookings')
  book(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.capacity.create(req.authSession.user.id, parseInput(createBookingSchema, body), key)
  }
  @Get('bookings')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const input = parseInput(bookingListSchema, query)
    return this.capacity.list(req.authSession.user.id, input.entityId, input.page, input.pageSize,false,input.segmentId,input.status)
  }
  @Post('bookings/:id/release')
  release(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.capacity.changeBooking(req.authSession.user.id, parseInput(z.uuid(), id), 'release', parseInput(reasonSchema, body).reason)
  }
  @Post('bookings/:id/activate')
  activate(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.capacity.changeBooking(req.authSession.user.id, parseInput(z.uuid(), id), 'activate', parseInput(activateSchema, body).operationalReference)
  }
  @Post('allocations/:id/deallocate')
  deallocate(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.capacity.deallocate(req.authSession.user.id, parseInput(z.uuid(), id), parseInput(reasonSchema, body).reason)
  }
  @Post('waiting-list')
  waiting(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.capacity.create(req.authSession.user.id, parseInput(createBookingSchema, body), key, true)
  }
  @Get('waiting-list')
  listWaiting(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const input = parseInput(waitingListSchema, query)
    return this.capacity.list(req.authSession.user.id, input.entityId, input.page, input.pageSize, true,input.segmentId,input.status)
  }
  @Post('waiting-list/:id/allocate')
  allocate(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Headers('idempotency-key') key?: string) {
    return this.capacity.changeWaiting(req.authSession.user.id, parseInput(z.uuid(), id), 'allocate', '', key)
  }
  @Post('waiting-list/:id/cancel')
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.capacity.changeWaiting(req.authSession.user.id, parseInput(z.uuid(), id), 'cancel', parseInput(reasonSchema, body).reason)
  }
  @Get('network/segments/:id/capacity')
  usage(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.capacity.usage(req.authSession.user.id, parseInput(z.uuid(), id))
  }
}
