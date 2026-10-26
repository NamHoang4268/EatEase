import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { loadEnvironment } from '../src/config/environment.js';

const environment = loadEnvironment();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }),
});

try {
  await prisma.$queryRaw`SELECT 1`;
  console.info('Database connection is healthy.');
} finally {
  await prisma.$disconnect();
}
