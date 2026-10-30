import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { FoundationExceptionFilter } from './common/filters/foundation-exception.filter.js';
import { loadEnvironment } from './config/environment.js';

const environment = loadEnvironment();
const application = await NestFactory.create(AppModule);
application.enableCors({
  origin: environment.TRUSTED_WEB_ORIGINS,
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
});
application.setGlobalPrefix('api/v1');
application.useGlobalFilters(new FoundationExceptionFilter());
application.enableShutdownHooks();
await application.listen(environment.API_PORT, '0.0.0.0');
