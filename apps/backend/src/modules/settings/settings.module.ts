import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { SettingsController } from './settings.controller.js'
import { SettingsService } from './settings.service.js'
import { PolicyRequestsService } from './policy-requests.service.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [SettingsController], providers: [SettingsService, PolicyRequestsService], exports: [SettingsService] })
export class SettingsModule {}
