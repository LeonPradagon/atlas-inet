import { Injectable } from '@nestjs/common'
import { z } from 'zod'

const originSchema = z.string().url().refine((value) => {
  const parsed = new URL(value)
  return ['http:', 'https:'].includes(parsed.protocol)
    && parsed.pathname === '/'
    && !parsed.search
    && !parsed.hash
}, 'Expected an HTTP(S) origin without a path')

const AppConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: originSchema.transform((value) => new URL(value).origin),
  TRUSTED_ORIGINS: z.string()
    .default('http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(originSchema).min(1))
    .transform((origins) => origins.map((origin) => new URL(origin).origin)),
  BUSINESS_TIMEZONE: z.string().default('Asia/Jakarta').refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Expected a valid IANA time zone'),
  FILE_STORAGE_PATH: z.string().min(1).default('./var/files'),
}).transform((env) => ({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  databaseUrl: env.DATABASE_URL,
  databasePoolSize: env.DATABASE_POOL_SIZE,
  betterAuthSecret: env.BETTER_AUTH_SECRET,
  betterAuthUrl: env.BETTER_AUTH_URL,
  trustedOrigins: env.TRUSTED_ORIGINS,
  businessTimezone: env.BUSINESS_TIMEZONE,
  fileStoragePath: env.FILE_STORAGE_PATH,
}))

export type AppConfig = z.infer<typeof AppConfigSchema>

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = AppConfigSchema.parse(environment)
  return config
}

export const APP_CONFIG = Symbol('APP_CONFIG')

@Injectable()
export class AppConfigService {
  readonly values = loadAppConfig()
}
