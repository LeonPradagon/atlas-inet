import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AppConfig } from '../../config/app-config.js'
import * as schema from '../../database/schema/index.js'

export function createAuth(
  database: NodePgDatabase<typeof schema>,
  config: AppConfig,
  allowSignUp = false,
) {
  return betterAuth({
    appName: 'ATLAS INET',
    baseURL: config.betterAuthUrl,
    basePath: '/api/auth',
    secret: config.betterAuthSecret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp,
      autoSignIn: false,
    },
    advanced: {
      useSecureCookies: config.nodeEnv === 'production' && config.betterAuthUrl.startsWith('https://'),
    },
  })
}
