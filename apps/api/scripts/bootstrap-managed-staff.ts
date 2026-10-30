import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { parseManagedStaffBootstrapInput } from './staff-bootstrap-targets.js';
import { provisionInitialManager } from './staff-provisioning.js';

const input = parseManagedStaffBootstrapInput(process.env, process.argv.slice(2));
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: input.databaseUrl, max: 1 }),
});

try {
  const result = await provisionInitialManager(prisma, {
    email: input.email,
    name: input.name,
    password: input.password,
    locationId: input.locationId,
    expectedRestaurantId: input.expectedRestaurantId,
  });
  console.info(
    result.status === 'created'
      ? 'Managed demo Manager provisioning completed.'
      : 'Managed demo Manager is already provisioned with the exact requested state.',
  );
} finally {
  await prisma.$disconnect();
}
