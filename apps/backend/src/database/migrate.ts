import { resolve } from 'node:path'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { loadAppConfig } from '../config/app-config.js'
import { loadEnvironment } from '../config/load-env.js'

const migrationLock = 1_415_135_331

async function runMigrations() {
  loadEnvironment()
  const config = loadAppConfig()
  const client = new Client({ connectionString: config.databaseUrl })
  let hasLock = false

  try {
    await client.connect()
    await client.query('SELECT pg_advisory_lock($1)', [migrationLock])
    hasLock = true
    await migrate(drizzle(client), { migrationsFolder: resolve('drizzle') })
  } finally {
    try {
      if (hasLock) await client.query('SELECT pg_advisory_unlock($1)', [migrationLock])
    } finally {
      await client.end()
    }
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Database migration failed', error)
  process.exitCode = 1
})
