import { Inject, Injectable } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { APP_CONFIG, type AppConfig } from '../config/app-config.js'
import * as schema from './schema/index.js'

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool
  readonly db: NodePgDatabase<typeof schema>

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePoolSize,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    })
    this.db = drizzle(this.pool, { schema })
  }

  async checkReady(): Promise<void> {
    await this.pool.query('SELECT PostGIS_Full_Version()')
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
