import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedCatalogFixtures } from '../src/catalog/catalog.fixtures.js';
import { loadEnvironment } from '../src/config/environment.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const environment = loadEnvironment();
const databaseUrl = new URL(environment.DATABASE_URL);
const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
const allowManagedDatabase = process.argv.includes('--allow-managed');

if (!isLocalDatabase && !allowManagedDatabase) {
  throw new Error('Refusing to seed a managed database without the explicit --allow-managed flag.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: environment.DATABASE_URL,
    max: 1,
  }),
});

try {
  await seedCatalogFixtures(prisma);
} finally {
  await prisma.$disconnect();
}
