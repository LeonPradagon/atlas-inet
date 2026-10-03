import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { setTimeout as delay } from 'node:timers/promises'
import { loadEnvironment } from './config/load-env.js'
import { WorkerModule } from './worker.module.js'
import { JobRunnerService } from './modules/jobs/job-runner.service.js'
async function bootstrap() {
  loadEnvironment()
  const app = await NestFactory.createApplicationContext(WorkerModule)
  const runner = app.get(JobRunnerService)
  let stopped = false
  const stop = () => { stopped=true }
  process.once('SIGINT',stop)
  process.once('SIGTERM',stop)
  try {
    while (!stopped) {
      try { if (!await runner.tick()) await delay(1000) } catch { console.error(JSON.stringify({ event:'WORKER_TICK_FAILED' }));await delay(5000) }
    }
  } finally { await app.close() }
}
void bootstrap()
