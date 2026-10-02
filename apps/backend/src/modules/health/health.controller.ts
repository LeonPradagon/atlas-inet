import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common'
import { DatabaseService } from '../../database/database.service.js'

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  getLiveness() {
    return { status: 'ok' }
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async getReadiness() {
    try {
      await this.database.checkReady()
      return { status: 'ok' }
    } catch {
      throw new ServiceUnavailableException('Service is not ready')
    }
  }
}
