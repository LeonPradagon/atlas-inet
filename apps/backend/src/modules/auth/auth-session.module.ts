import { Module } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { AuthSessionGuard } from './auth-session.guard.js'

@Module({
  providers: [AuthService, AuthSessionGuard],
  exports: [AuthService, AuthSessionGuard],
})
export class AuthSessionModule {}
