import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { assertLocalStaffBootstrapTarget } from './staff-bootstrap-targets.js';
import { provisionInitialManager } from './staff-provisioning.js';

const inputSchema = z.object({
  databaseUrl: z.url().startsWith('postgresql://'),
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(160),
  password: z.string().min(12).max(256),
  locationId: z.uuid(),
});

const input = inputSchema.parse({
  databaseUrl: process.env.DATABASE_URL,
  email: process.env.STAFF_BOOTSTRAP_EMAIL,
  name: process.env.STAFF_BOOTSTRAP_NAME,
  password: process.env.STAFF_BOOTSTRAP_PASSWORD,
  locationId: process.env.STAFF_BOOTSTRAP_LOCATION_ID,
});

assertLocalStaffBootstrapTarget(input.databaseUrl);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: input.databaseUrl, max: 1 }),
});

try {
  const existingUser = await prisma.staffUser.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingUser) {
    throw new Error('Staff identity already exists; bootstrap will not overwrite it.');
  }

  const result = await provisionInitialManager(prisma, input);
  if (result.status === 'already-provisioned') {
    throw new Error('Staff identity already exists; bootstrap will not overwrite it.');
  }

  console.log('Staff bootstrap completed.');
} finally {
  await prisma.$disconnect();
}
