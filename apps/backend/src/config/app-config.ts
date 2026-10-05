import { Injectable } from '@nestjs/common'
import { z } from 'zod'

const originSchema = z.string().url().refine((value) => {
  const parsed = new URL(value)
  return ['http:', 'https:'].includes(parsed.protocol)
    && parsed.pathname === '/'
    && !parsed.search
    && !parsed.hash
}, 'Expected an HTTP(S) origin without a path')
const internalUrlSchema = z.preprocess((value) => value === '' ? undefined : value,
  z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)).optional())
const photonPublicDevUrlSchema = z.preprocess((value) => value === '' ? undefined : value,
  z.string().url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'photon.komoot.io' && url.pathname === '/' && !url.search && !url.hash
  }, 'Public development geocoder must use https://photon.komoot.io').optional())

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
  BUSINESS_TIMEZONE: z.literal('Asia/Jakarta').default('Asia/Jakarta'),
  FILE_STORAGE_PATH: z.string().min(1).default('./var/files'),
  GEOCODING_INTERNAL_URL: internalUrlSchema,
  PHOTON_INTERNAL_URL: internalUrlSchema,
  PHOTON_PUBLIC_DEV_URL: photonPublicDevUrlSchema,
  GEOCODING_DATASET_VERSION: z.string().trim().min(1).max(200).optional(),
  ROUTING_INTERNAL_URL: internalUrlSchema,
  WORKER_INTERVAL_MS: z.coerce.number().int().min(10).max(60_000).default(1000),
}).refine((env) => {
  const photonCount = Number(Boolean(env.PHOTON_INTERNAL_URL)) + Number(Boolean(env.PHOTON_PUBLIC_DEV_URL))
  return photonCount <= 1
    && !(env.GEOCODING_INTERNAL_URL && photonCount > 0)
    && (!env.PHOTON_PUBLIC_DEV_URL || env.NODE_ENV === 'development')
}, 'Choose one geocoder; public Photon is restricted to development').transform((env) => ({
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
  geocodingInternalUrl: env.GEOCODING_INTERNAL_URL,
  photonInternalUrl: env.PHOTON_INTERNAL_URL,
  photonPublicDevUrl: env.PHOTON_PUBLIC_DEV_URL,
  geocodingDatasetVersion: env.GEOCODING_DATASET_VERSION,
  routingInternalUrl: env.ROUTING_INTERNAL_URL,
  workerIntervalMs: env.WORKER_INTERVAL_MS,
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
