import { Global, Module } from '@nestjs/common'
import { APP_CONFIG, AppConfigService } from './app-config.js'

@Global()
@Module({
  providers: [
    AppConfigService,
    {
      provide: APP_CONFIG,
      useFactory: (config: AppConfigService) => config.values,
      inject: [AppConfigService],
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
