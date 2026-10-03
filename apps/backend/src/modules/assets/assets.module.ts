import { Module } from '@nestjs/common'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { CapacityModule } from '../capacity/capacity.module.js'
import { AssetsController } from './assets.controller.js'
import { AssetsService } from './assets.service.js'
import { AccessModule } from '../access/access.module.js'
@Module({ imports: [AuthSessionModule, CapacityModule, AccessModule], controllers: [AssetsController], providers: [AssetsService] })
export class AssetsModule {}
