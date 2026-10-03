import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { ImportsController } from './imports.controller.js'
import { ImportsService } from './imports.service.js'
import { AnalysisModule } from '../analysis/analysis.module.js'
@Module({ imports: [AccessModule, AuthSessionModule, AnalysisModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
