import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { StaffMembershipStatus, StaffUserStatus } from '../src/generated/prisma/enums.js';
import { verifyPassword } from '../src/staff-auth/auth.crypto.js';
import { INITIAL_PERMISSION_CODES } from '../src/staff-auth/permission-codes.js';
import { provisionInitialManager } from './staff-provisioning.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for staff provisioning tests.');
const databaseUrl = new URL(databaseUrlValue);
const databaseName = databaseUrl.pathname.replace(/^\//, '');
if (
  !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
  (databaseName !== 'eatease_m2_test' && process.env.CI !== 'true')
) {
  throw new Error(
    'Staff provisioning tests require isolated local eatease_m2_test or ephemeral CI.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrlValue, max: 2 }),
});

const ids = {
  restaurant: 'e1000000-0000-4000-8000-000000000001',
  location: 'e2000000-0000-4000-8000-000000000001',
  inactiveLocation: 'e2000000-0000-4000-8000-000000000002',
  rollbackRestaurant: 'e1000000-0000-4000-8000-000000000002',
  rollbackLocation: 'e2000000-0000-4000-8000-000000000003',
} as const;

const email = 'managed-bootstrap-test@example.test';
const password = 'managed-bootstrap-test-password';

async function cleanup(): Promise<void> {
  const restaurants = [ids.restaurant, ids.rollbackRestaurant];
  const users = await prisma.staffUser.findMany({
    where: { email: { in: [email, 'rollback-bootstrap-test@example.test'] } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  const roles = await prisma.role.findMany({
    where: { restaurantId: { in: restaurants } },
    select: { id: true },
  });
  const roleIds = roles.map(({ id }) => id);

  if (userIds.length > 0) {
    await prisma.staffSession.deleteMany({ where: { staffUserId: { in: userIds } } });
    const memberships = await prisma.staffMembership.findMany({
      where: { staffUserId: { in: userIds } },
      select: { id: true },
    });
    await prisma.membershipRole.deleteMany({
      where: { membershipId: { in: memberships.map(({ id }) => id) } },
    });
    await prisma.staffMembership.deleteMany({ where: { staffUserId: { in: userIds } } });
    await prisma.staffUser.deleteMany({ where: { id: { in: userIds } } });
  }
  if (roleIds.length > 0) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  }
  await prisma.permission.deleteMany({
    where: {
      code: { in: [...INITIAL_PERMISSION_CODES] },
      roles: { none: {} },
    },
  });
  await prisma.location.deleteMany({ where: { restaurantId: { in: restaurants } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurants } } });
}

async function createScopes(): Promise<void> {
  await prisma.restaurant.createMany({
    data: [
      { id: ids.restaurant, name: 'Bootstrap Test Restaurant' },
      { id: ids.rollbackRestaurant, name: 'Rollback Test Restaurant' },
    ],
  });
  await prisma.location.createMany({
    data: [
      {
        id: ids.location,
        restaurantId: ids.restaurant,
        code: 'BOOT-ACTIVE',
        name: 'Bootstrap Active',
        isActive: true,
      },
      {
        id: ids.inactiveLocation,
        restaurantId: ids.restaurant,
        code: 'BOOT-INACTIVE',
        name: 'Bootstrap Inactive',
        isActive: false,
      },
      {
        id: ids.rollbackLocation,
        restaurantId: ids.rollbackRestaurant,
        code: 'BOOT-ROLLBACK',
        name: 'Bootstrap Rollback',
        isActive: true,
      },
    ],
  });
}

describe('managed staff provisioning persistence', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
    await createScopes();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('rejects an inactive location without creating privileged records', async () => {
    await expect(
      provisionInitialManager(prisma, {
        email,
        name: 'Managed Bootstrap Test',
        password,
        locationId: ids.inactiveLocation,
        expectedRestaurantId: ids.restaurant,
      }),
    ).rejects.toThrow(/not active/);

    await expect(prisma.staffUser.count({ where: { email } })).resolves.toBe(0);
    await expect(
      prisma.role.count({ where: { restaurantId: ids.restaurant, code: 'MANAGER' } }),
    ).resolves.toBe(0);
  });

  it('creates one active Manager atomically and treats an exact rerun as a no-op', async () => {
    const input = {
      email,
      name: 'Managed Bootstrap Test',
      password,
      locationId: ids.location,
      expectedRestaurantId: ids.restaurant,
    } as const;

    const created = await provisionInitialManager(prisma, input);
    const rerun = await provisionInitialManager(prisma, input);
    expect(created.status).toBe('created');
    expect(rerun).toEqual({ ...created, status: 'already-provisioned' });

    const user = await prisma.staffUser.findUniqueOrThrow({
      where: { email },
      include: {
        memberships: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: { include: { permission: { select: { code: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const membership = user.memberships[0]!;
    const role = membership.roles[0]!.role;
    const permissionCodes = role.permissions.map(({ permission }) => permission.code).sort();

    expect(user).toMatchObject({ name: input.name, status: StaffUserStatus.ACTIVE });
    expect(user.passwordHash).not.toContain(password);
    await expect(verifyPassword(password, user.passwordHash)).resolves.toBe(true);
    expect(membership).toMatchObject({
      restaurantId: ids.restaurant,
      locationId: ids.location,
      status: StaffMembershipStatus.ACTIVE,
    });
    expect(role).toMatchObject({ code: 'MANAGER', name: 'Manager', isSystem: true });
    expect(permissionCodes).toEqual([...INITIAL_PERMISSION_CODES].sort());
    expect(permissionCodes).toEqual(
      expect.arrayContaining([
        'table.activation.read',
        'table.activation.approve',
        'table.session.read',
        'table.join_code.manage',
      ]),
    );
    await expect(prisma.staffUser.count({ where: { email } })).resolves.toBe(1);
    await expect(prisma.staffMembership.count({ where: { staffUserId: user.id } })).resolves.toBe(
      1,
    );
  });

  it('rejects an existing identity when the requested password or scope does not match', async () => {
    await provisionInitialManager(prisma, {
      email,
      name: 'Managed Bootstrap Test',
      password,
      locationId: ids.location,
      expectedRestaurantId: ids.restaurant,
    });

    await expect(
      provisionInitialManager(prisma, {
        email,
        name: 'Managed Bootstrap Test',
        password: 'different-managed-bootstrap-password',
        locationId: ids.location,
        expectedRestaurantId: ids.restaurant,
      }),
    ).rejects.toThrow(/conflicts/);
    await expect(
      provisionInitialManager(prisma, {
        email,
        name: 'Managed Bootstrap Test',
        password,
        locationId: ids.rollbackLocation,
        expectedRestaurantId: ids.rollbackRestaurant,
      }),
    ).rejects.toThrow(/conflicts/);
  });

  it('rolls back role initialization when user creation fails', async () => {
    await expect(
      provisionInitialManager(prisma, {
        email: 'rollback-bootstrap-test@example.test',
        name: 'x'.repeat(161),
        password,
        locationId: ids.rollbackLocation,
        expectedRestaurantId: ids.rollbackRestaurant,
      }),
    ).rejects.toThrow();

    await expect(
      prisma.staffUser.count({ where: { email: 'rollback-bootstrap-test@example.test' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.role.count({
        where: { restaurantId: ids.rollbackRestaurant, code: 'MANAGER' },
      }),
    ).resolves.toBe(0);
  });
});
