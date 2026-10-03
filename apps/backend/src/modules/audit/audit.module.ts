import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { AuditController } from './audit.controller.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [AuditController] })
export class AuditModule {}
