import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let application: INestApplication | undefined;

  afterEach(async () => {
    await application?.close();
  });

  it('returns liveness and database-backed readiness', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
      ],
    }).compile();

    application = testingModule.createNestApplication();
    application.setGlobalPrefix('api/v1');
    await application.init();
    const server = application.getHttpServer() as Server;

    await request(server).get('/api/v1/health').expect(200, {
      status: 'ok',
      service: 'api',
    });
    await request(server).get('/api/v1/health/ready').expect(200, {
      status: 'ready',
      database: 'reachable',
    });
  });
});
