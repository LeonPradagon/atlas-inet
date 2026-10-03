import { Module } from '@nestjs/common'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { AccessController } from './access.controller.js'
import { AccessRepository } from './access.repository.js'
import { AccessService } from './access.service.js'
import { EntityPermissionGuard } from './entity-permission.guard.js'

@Module({
  imports: [AuthSessionModule],
  controllers: [AccessController],
  providers: [AccessRepository, AccessService, EntityPermissionGuard],
  exports: [AccessService, EntityPermissionGuard],
})
export class AccessModule {}
