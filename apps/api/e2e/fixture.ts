import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import { hashPassword } from '../src/staff-auth/auth.crypto.js';
import { assertLocalE2eDatabase } from './local-target.js';

export async function createFixture() {
  const databaseName = assertLocalE2eDatabase();
  const prisma = new PrismaService();
  await prisma.$connect();
  const [identity] = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  if (identity?.name !== databaseName) {
    await prisma.$disconnect();
    throw new Error('E2E database identity mismatch before writes');
  }
  const roleIds: string[] = [],
    permissionIds: string[] = [];
  const password = randomUUID() + '-synthetic-only';
  const passwordHash = await hashPassword(password);
  const restaurant = await prisma.restaurant.create({ data: { name: 'M2 E2E synthetic' } });
  const location = await prisma.location.create({
    data: { restaurantId: restaurant.id, code: 'E2E', name: 'E2E local', isActive: true },
  });
  const scope = { restaurantId: restaurant.id, locationId: location.id };
  const tables = await Promise.all(
    ['A01', 'A02'].map((code) =>
      prisma.restaurantTable.create({ data: { ...scope, code, capacity: 4 } }),
    ),
  );
  const category = await prisma.menuCategory.create({
    data: { ...scope, name: 'E2E menu', displayOrder: 0 },
  });
  const item = await prisma.menuItem.create({
    data: {
      ...scope,
      categoryId: category.id,
      name: 'E2E rice',
      priceAmount: 42_000n,
      fulfillmentStation: 'KITCHEN',
    },
  });

  async function staff(kind: string, grants: string[][]) {
    const user = await prisma.staffUser.create({
      data: { email: `e2e-${randomUUID()}@example.test`, name: kind, passwordHash },
    });
    const membership = await prisma.staffMembership.create({
      data: { ...scope, staffUserId: user.id },
    });
    for (const [index, codes] of grants.entries()) {
      const role = await prisma.role.create({
        data: { restaurantId: restaurant.id, code: `${kind}-${index}`, name: kind },
      });
      roleIds.push(role.id);
      for (const code of codes) {
        const candidate = randomUUID();
        const permission = await prisma.permission.upsert({
          where: { code },
          create: { id: candidate, code },
          update: {},
        });
        if (permission.id === candidate) permissionIds.push(candidate);
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
      await prisma.membershipRole.create({
        data: { restaurantId: restaurant.id, membershipId: membership.id, roleId: role.id },
      });
    }
    return { email: user.email, id: user.id, membershipId: membership.id };
  }
  const manager = await staff('E2E-WAITER', [
    [
      'table.activation.read',
      'table.activation.approve',
      'table.session.read',
      'table.join_code.manage',
      'order.create_for_table',
    ],
    ['bill.read', 'table.session.read'],
  ]);
  const kitchen = await staff('E2E-KITCHEN', [['fulfillment.read']]);
  return {
    prisma,
    scope,
    tables,
    item,
    manager,
    kitchen,
    password,
    async close() {
      try {
        // Keep all submitted/financial history; delete only this run's ephemeral RBAC links.
        await prisma.membershipRole.deleteMany({ where: { roleId: { in: roleIds } } });
        await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
        await prisma.permission.deleteMany({
          where: { id: { in: permissionIds }, roles: { none: {} } },
        });
      } finally {
        await prisma.$disconnect();
      }
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof createFixture>>;
