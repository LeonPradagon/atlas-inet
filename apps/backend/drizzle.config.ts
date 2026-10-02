import { config as loadDotEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

loadDotEnv({ path: '.env', quiet: true })
loadDotEnv({ path: '../../.env', quiet: true })

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://atlas:atlas_dev_password@localhost:5432/atlas',
  },
  strict: true,
  verbose: true,
})
