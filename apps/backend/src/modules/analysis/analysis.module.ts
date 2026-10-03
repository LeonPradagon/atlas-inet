import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { InternalAdapters } from './internal-adapters.js'
import { AnalysisController } from './analysis.controller.js'
import { AnalysisService } from './analysis.service.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [AnalysisController], providers: [InternalAdapters, AnalysisService], exports: [AnalysisService, InternalAdapters] })
export class AnalysisModule {}
