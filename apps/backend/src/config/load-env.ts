import { config as loadDotEnv } from 'dotenv'
import { resolve } from 'node:path'

export function loadEnvironment(): void {
  loadDotEnv({ path: resolve(process.cwd(), '.env'), quiet: true })
  loadDotEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true })
}
