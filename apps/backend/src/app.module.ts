import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { DatabaseModule } from './database/database.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { HealthModule } from './modules/health/health.module.js'
import { NetworkModule } from './modules/network/network.module.js'
import { SettingsModule } from './modules/settings/settings.module.js'
import { CapacityModule } from './modules/capacity/capacity.module.js'
import { NotificationsModule } from './modules/notifications/notifications.module.js'
import { AnalysisModule } from './modules/analysis/analysis.module.js'
import { AssetsModule } from './modules/assets/assets.module.js'
import { AuditModule } from './modules/audit/audit.module.js'
import { ReportsModule } from './modules/reports/reports.module.js'
import { ImportsModule } from './modules/imports/imports.module.js'
import { JobsModule } from './modules/jobs/jobs.module.js'

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, HealthModule, NetworkModule, SettingsModule, CapacityModule, NotificationsModule, AnalysisModule, AssetsModule, AuditModule, ReportsModule, ImportsModule, JobsModule],
})
export class AppModule {}
