import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { NestFactory } from '@nestjs/core'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { toNodeHandler } from 'better-auth/node'
import { ApiExceptionFilter } from './common/api-exception.filter.js'
import { loadAppConfig } from './config/app-config.js'
import { loadEnvironment } from './config/load-env.js'
import { AppModule } from './app.module.js'
import { AuthService } from './modules/auth/auth.service.js'
import { NotificationsRealtimeGateway } from './modules/notifications/notifications-realtime.gateway.js'

async function bootstrap() {
  loadEnvironment()
  const config = loadAppConfig()
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const server = app.getHttpAdapter().getInstance() as Express
  const trustedOrigins = new Set(config.trustedOrigins)

  server.set('trust proxy', config.trustProxyHops)
  server.use(helmet())
  server.use((_request, response, next) => {
    const requestId = randomUUID()
    response.locals.requestId = requestId
    response.setHeader('X-Request-Id', requestId)
    next()
  })

  const authHandler = toNodeHandler(app.get(AuthService).instance)
  server.all('/api/auth', authHandler)
  server.all('/api/auth/*path', authHandler)

  server.use('/api/v1', cors({
    origin: (origin, callback) => callback(null, !origin || trustedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'If-Match', 'Idempotency-Key', 'X-CSRF-Token'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
  }))
  server.use('/api/v1', (request, response, next) => {
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    const origin = request.get('origin')
    if (!isSafeMethod && (!origin || !trustedOrigins.has(origin))) {
      response.status(403).json({
        error: { code: 'UNTRUSTED_ORIGIN', message: 'Request origin is not allowed' },
        requestId: response.locals.requestId,
      })
      return
    }
    next()
  })
  server.use('/api/v1', express.json({ limit: '1mb' }))

  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new ApiExceptionFilter())
  app.enableShutdownHooks()
  await app.listen(config.port, '0.0.0.0')
  await app.get(NotificationsRealtimeGateway).start(app.getHttpServer())
  console.log(JSON.stringify({ event: 'API_LISTENING', port: config.port }))
}

void bootstrap()
