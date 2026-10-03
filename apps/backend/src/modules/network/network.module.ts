import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { NetworkController } from './network.controller.js'
import { NetworkRepository } from './network.repository.js'
import { NetworkService } from './network.service.js'

@Module({
  imports: [AuthSessionModule, AccessModule],
  controllers: [NetworkController],
  providers: [NetworkRepository, NetworkService],
})
export class NetworkModule {}
