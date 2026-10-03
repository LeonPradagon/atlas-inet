import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthSessionModule } from './auth-session.module.js'
import { AccessModule } from '../access/access.module.js'

@Module({
  imports: [AuthSessionModule, AccessModule],
  controllers: [AuthController],
  exports: [AuthSessionModule],
})
export class AuthModule {}
