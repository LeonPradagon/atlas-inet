import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { DatabaseModule } from './database/database.module.js'
import { AccessModule } from './modules/access/access.module.js'
import { AnalysisModule } from './modules/analysis/analysis.module.js'
import { CapacityModule } from './modules/capacity/capacity.module.js'
import { NotificationsModule } from './modules/notifications/notifications.module.js'
import { JobRunnerService } from './modules/jobs/job-runner.service.js'
@Module({ imports:[ConfigModule,DatabaseModule,AccessModule,AnalysisModule,CapacityModule,NotificationsModule],providers:[JobRunnerService] })
export class WorkerModule {}
