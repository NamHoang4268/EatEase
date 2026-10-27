import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { hashPassword } from '../src/staff-auth/auth.crypto.js';
import { INITIAL_PERMISSION_CODES } from '../src/staff-auth/permission-codes.js';
import { RestaurantStatus } from '../src/generated/prisma/enums.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

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

const databaseUrl = new URL(input.databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error(
    'Staff bootstrap is restricted to a local database. Managed targets require a separate owner-approved operation.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: input.databaseUrl, max: 1 }),
});

try {
  const location = await prisma.location.findFirst({
    where: {
      id: input.locationId,
      isActive: true,
      restaurant: { status: RestaurantStatus.ACTIVE },
    },
    select: { id: true, restaurantId: true },
  });
  if (!location) throw new Error('Target location is not active or does not exist.');

  const existingUser = await prisma.staffUser.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingUser)
    throw new Error('Staff identity already exists; bootstrap will not overwrite it.');

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (transaction) => {
    const permissions = await Promise.all(
      INITIAL_PERMISSION_CODES.map((code) =>
        transaction.permission.upsert({
          where: { code },
          update: {},
          create: { code },
          select: { id: true },
        }),
      ),
    );
    const role = await transaction.role.upsert({
      where: { restaurantId_code: { restaurantId: location.restaurantId, code: 'MANAGER' } },
      update: {},
      create: {
        restaurantId: location.restaurantId,
        code: 'MANAGER',
        name: 'Manager',
        isSystem: true,
      },
      select: { id: true },
    });
    await transaction.rolePermission.createMany({
      data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
      skipDuplicates: true,
    });
    const user = await transaction.staffUser.create({
      data: { email: input.email, name: input.name, passwordHash },
      select: { id: true },
    });
    const membership = await transaction.staffMembership.create({
      data: {
        staffUserId: user.id,
        restaurantId: location.restaurantId,
        locationId: location.id,
      },
      select: { id: true },
    });
    await transaction.membershipRole.create({
      data: {
        membershipId: membership.id,
        roleId: role.id,
        restaurantId: location.restaurantId,
      },
    });
  });

  console.log('Staff bootstrap completed.');
} finally {
  await prisma.$disconnect();
}
