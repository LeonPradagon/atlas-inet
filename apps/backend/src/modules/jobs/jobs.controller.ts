import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { z } from 'zod'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
import { uploadLimits,validateUpload,type UploadFile } from '../files/tabular-files.js'
import { JobsService } from './jobs.service.js'
const rowQuery = entityPageSchema.omit({ entityId:true })
@Controller()
@UseGuards(AuthSessionGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}
  @Post('analysis/uploads')
  @UseInterceptors(FileInterceptor('file',{ limits:uploadLimits }))
  upload(@Req() req: AuthenticatedRequest,@Body() body: unknown,@UploadedFile() file: UploadFile | undefined) {
    return this.jobs.upload(req.authSession.user.id,parseInput(z.object({ entityId:z.uuid() }).strict(),body).entityId,validateUpload(file))
  }
  @Post('analysis/jobs')
  @HttpCode(202)
  submit(@Req() req: AuthenticatedRequest,@Body() body: unknown) {
    const input = parseInput(z.object({ uploadId:z.uuid(),processValidRows:z.boolean() }).strict(),body)
    return this.jobs.submit(req.authSession.user.id,input.uploadId,input.processValidRows)
  }
  @Post('reports/exports')
  @HttpCode(202)
  export(@Req() req: AuthenticatedRequest,@Body() body: unknown) { return this.jobs.export(req.authSession.user.id,parseInput(z.object({ entityId:z.uuid() }).strict(),body).entityId) }
  @Get('jobs/:id')
  get(@Req() req: AuthenticatedRequest,@Param('id') id: string) { return this.jobs.get(req.authSession.user.id,parseInput(z.uuid(),id)) }
  @Get('jobs/:id/rows')
  rows(@Req() req: AuthenticatedRequest,@Param('id') id: string,@Query() query: unknown) {
    const input = parseInput(rowQuery,query)
    return this.jobs.rows(req.authSession.user.id,parseInput(z.uuid(),id),input.page,input.pageSize)
  }
  @Post('jobs/:id/cancel')
  cancel(@Req() req: AuthenticatedRequest,@Param('id') id: string) { return this.jobs.cancel(req.authSession.user.id,parseInput(z.uuid(),id)) }
  @Post('jobs/:id/retry')
  @HttpCode(202)
  retry(@Req() req: AuthenticatedRequest,@Param('id') id: string) { return this.jobs.retry(req.authSession.user.id,parseInput(z.uuid(),id)) }
  @Get('jobs/:id/result')
  async result(@Req() req: AuthenticatedRequest,@Param('id') id: string,@Res() response: Response) {
    const jobId = parseInput(z.uuid(),id)
    const file = await this.jobs.result(req.authSession.user.id,jobId)
    response.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`atlas-${jobId}.xlsx`).send(file)
  }
}
