import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';

describe('database readiness', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('reports ready after a real PostgreSQL query', async () => {
    const server = application.getHttpServer() as Server;
    await request(server).get('/api/v1/health/ready').expect(200, {
      status: 'ready',
      database: 'reachable',
    });
  });
});
