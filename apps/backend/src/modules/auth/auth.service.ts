import { Inject, Injectable } from '@nestjs/common'
import { fromNodeHeaders } from 'better-auth/node'
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js'
import { DatabaseService } from '../../database/database.service.js'
import { createAuth } from './auth.js'

@Injectable()
export class AuthService {
  readonly instance

  constructor(
    database: DatabaseService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.instance = createAuth(database.db, config)
  }

  getSession(headers: NodeJS.Dict<string | string[]>) {
    return this.instance.api.getSession({ headers: fromNodeHeaders(headers) })
  }
}

export type AuthSession = NonNullable<Awaited<ReturnType<AuthService['getSession']>>>
