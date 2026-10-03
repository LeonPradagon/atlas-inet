import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { JobsController } from './jobs.controller.js'
import { JobsService } from './jobs.service.js'
@Module({ imports:[AccessModule,AuthSessionModule],controllers:[JobsController],providers:[JobsService],exports:[JobsService] })
export class JobsModule {}
