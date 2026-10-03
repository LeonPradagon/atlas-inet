import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { ReportsController } from './reports.controller.js'
import { ReportsService } from './reports.service.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
