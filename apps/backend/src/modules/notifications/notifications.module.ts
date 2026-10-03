import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
