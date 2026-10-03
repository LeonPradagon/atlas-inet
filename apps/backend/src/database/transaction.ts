import type { DatabaseService } from './database.service.js'
export type Transaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0]
