import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { z } from 'zod'
import { parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { uploadLimits, validateUpload, type UploadFile } from '../files/tabular-files.js'
import { ImportsService } from './imports.service.js'
const uploadSchema = z.object({ entityId: z.uuid(), sourceSystem: z.string().trim().min(1).max(100), mappings: z.string().max(512 * 1024).optional() }).strict()
@Controller('imports')
@UseGuards(AuthSessionGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits }))
  preview(@Req() req: AuthenticatedRequest, @UploadedFile() file: UploadFile | undefined, @Body() body: unknown) {
    const input = parseInput(uploadSchema, body)
    let mapping: unknown = {}
    if (input.mappings) { try { mapping = JSON.parse(input.mappings) } catch { mapping = null } }
    return this.imports.preview(req.authSession.user.id, input.entityId, input.sourceSystem, validateUpload(file), parseInput(z.record(z.string(), z.record(z.string(), z.unknown())), mapping))
  }
  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.imports.get(req.authSession.user.id, parseInput(z.uuid(), id)) }
  @Post(':id/rows/:rowNumber/geocode')
  geocode(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('rowNumber') rowNumber: string) {
    return this.imports.geocodeRow(req.authSession.user.id, parseInput(z.uuid(), id), parseInput(z.coerce.number().int().positive(), rowNumber))
  }
  @Post(':id/rows/:rowNumber/confirm-coordinates')
  confirmCoordinates(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('rowNumber') rowNumber: string, @Body() body: unknown) {
    const input = parseInput(z.object({ lookupId: z.uuid(), candidateIndex: z.number().int().min(0).max(19) }).strict(), body)
    return this.imports.confirmRow(req.authSession.user.id, parseInput(z.uuid(), id), parseInput(z.coerce.number().int().positive(), rowNumber), input.lookupId, input.candidateIndex)
  }
  @Post(':id/publish')
  publish(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.imports.publish(req.authSession.user.id, parseInput(z.uuid(), id), parseInput(z.object({ version: z.string().trim().min(1).max(100) }).strict(), body).version)
  }
  @Post(':id/publish-areas')
  publishAreas(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.imports.publishAreas(req.authSession.user.id, parseInput(z.uuid(), id), parseInput(z.object({ version: z.string().trim().min(1).max(100) }).strict(), body).version)
  }
}
