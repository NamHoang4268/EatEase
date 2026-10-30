import { StaffMembershipStatus, StaffUserStatus } from '../src/generated/prisma/enums.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword, verifyPassword } from '../src/staff-auth/auth.crypto.js';
import { INITIAL_PERMISSION_CODES } from '../src/staff-auth/permission-codes.js';

const MANAGER_ROLE_CODE = 'MANAGER';
const MANAGER_ROLE_NAME = 'Manager';
const approvedPermissionCodes = new Set<string>(INITIAL_PERMISSION_CODES);

export type InitialManagerInput = {
  email: string;
  name: string;
  password: string;
  locationId: string;
  expectedRestaurantId?: string;
};

export type InitialManagerResult = {
  status: 'created' | 'already-provisioned';
  staffUserId: string;
  membershipId: string;
  roleId: string;
};

function permissionSetMatches(codes: readonly string[]): boolean {
  return (
    codes.length === approvedPermissionCodes.size &&
    codes.every((code) => approvedPermissionCodes.has(code))
  );
}

function assertExpectedManagerRole(role: {
  name: string;
  isSystem: boolean;
  permissions: Array<{ permission: { code: string } }>;
}): void {
  if (!role.isSystem || role.name !== MANAGER_ROLE_NAME) {
    throw new Error('Existing MANAGER role is not the expected system role.');
  }

  const unexpectedPermission = role.permissions.find(
    ({ permission }) => !approvedPermissionCodes.has(permission.code),
  );
  if (unexpectedPermission) {
    throw new Error('Existing MANAGER role contains an unexpected permission grant.');
  }
}

export async function provisionInitialManager(
  prisma: PrismaClient,
  input: InitialManagerInput,
): Promise<InitialManagerResult> {
  return prisma.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: {
        id: input.locationId,
        ...(input.expectedRestaurantId ? { restaurantId: input.expectedRestaurantId } : {}),
        isActive: true,
        restaurant: { status: 'ACTIVE' },
      },
      select: { id: true, restaurantId: true },
    });
    if (!location) throw new Error('Target location is not active or does not exist.');

    const managerRole = await transaction.role.findUnique({
      where: {
        restaurantId_code: {
          restaurantId: location.restaurantId,
          code: MANAGER_ROLE_CODE,
        },
      },
      include: {
        permissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (managerRole) assertExpectedManagerRole(managerRole);

    const existingUser = await transaction.staffUser.findUnique({
      where: { email: input.email },
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

    if (existingUser) {
      const membership = existingUser.memberships[0];
      const assignedRole = membership?.roles[0]?.role;
      const passwordMatches = await verifyPassword(input.password, existingUser.passwordHash);
      const exactMatch =
        existingUser.status === StaffUserStatus.ACTIVE &&
        existingUser.name === input.name &&
        passwordMatches &&
        existingUser.memberships.length === 1 &&
        membership !== undefined &&
        membership.status === StaffMembershipStatus.ACTIVE &&
        membership.restaurantId === location.restaurantId &&
        membership.locationId === location.id &&
        membership.roles.length === 1 &&
        assignedRole !== undefined &&
        managerRole !== null &&
        assignedRole.id === managerRole.id &&
        assignedRole.code === MANAGER_ROLE_CODE &&
        assignedRole.isSystem &&
        assignedRole.name === MANAGER_ROLE_NAME &&
        permissionSetMatches(assignedRole.permissions.map(({ permission }) => permission.code));

      if (!exactMatch || !membership || !assignedRole) {
        throw new Error('Existing staff identity conflicts with the requested provisioning state.');
      }

      return {
        status: 'already-provisioned',
        staffUserId: existingUser.id,
        membershipId: membership.id,
        roleId: assignedRole.id,
      };
    }

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
    const role =
      managerRole ??
      (await transaction.role.create({
        data: {
          restaurantId: location.restaurantId,
          code: MANAGER_ROLE_CODE,
          name: MANAGER_ROLE_NAME,
          isSystem: true,
        },
        select: { id: true },
      }));

    await transaction.rolePermission.createMany({
      data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
      skipDuplicates: true,
    });

    const passwordHash = await hashPassword(input.password);
    const user = await transaction.staffUser.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        status: StaffUserStatus.ACTIVE,
      },
      select: { id: true },
    });
    const membership = await transaction.staffMembership.create({
      data: {
        staffUserId: user.id,
        restaurantId: location.restaurantId,
        locationId: location.id,
        status: StaffMembershipStatus.ACTIVE,
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

    return {
      status: 'created',
      staffUserId: user.id,
      membershipId: membership.id,
      roleId: role.id,
    };
  });
}
