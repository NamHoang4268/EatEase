import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadEnvironment } from '../config/environment.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const environment = loadEnvironment();
    super({
      adapter: new PrismaPg({
        connectionString: environment.DATABASE_URL,
        max: environment.DATABASE_POOL_MAX,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
