import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { AuthSessionModule } from '../auth/auth-session.module.js'
import { CapacityController } from './capacity.controller.js'
import { CapacityRepository } from './capacity.repository.js'
import { CapacityService } from './capacity.service.js'
@Module({ imports: [AccessModule, AuthSessionModule], controllers: [CapacityController], providers: [CapacityRepository, CapacityService], exports: [CapacityRepository, CapacityService] })
export class CapacityModule {}
