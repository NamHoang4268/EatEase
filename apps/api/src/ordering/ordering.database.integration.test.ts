import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FoundationExceptionFilter } from '../common/filters/foundation-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { hashToken } from '../staff-auth/auth.crypto.js';
import type { StaffPrincipal } from '../staff-auth/staff-auth.types.js';
import type { ConsolidatedSessionView } from './ordering.contract.js';
import { OrderingService } from './ordering.service.js';

const databaseUrlValue = process.env.DATABASE_URL;
if (!databaseUrlValue) throw new Error('DATABASE_URL is required for M2.9 integration tests.');
const target = new URL(databaseUrlValue);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
if (!local || (target.pathname !== '/eatease_m2_test' && process.env.CI !== 'true')) {
  throw new Error('M2.9 tests require isolated local eatease_m2_test or ephemeral local CI.');
}
process.env.NODE_ENV = 'test';
process.env.TRUSTED_WEB_ORIGINS = 'http://localhost:3000';

const ids = {
  restaurant: randomUUID(),
  location: randomUUID(),
  table: randomUUID(),
  tablePublic: randomUUID(),
  category: randomUUID(),
  item: randomUUID(),
  guest: randomUUID(),
  browseGuest: randomUUID(),
  activation: randomUUID(),
  tableSession: randomUUID(),
  bill: randomUUID(),
  staffUser: randomUUID(),
  membership: randomUUID(),
  role: randomUUID(),
  staffSession: randomUUID(),
  noPermissionUser: randomUUID(),
  noPermissionMembership: randomUUID(),
  noPermissionSession: randomUUID(),
  foreignRestaurant: randomUUID(),
  foreignLocation: randomUUID(),
  foreignTable: randomUUID(),
  foreignGuest: randomUUID(),
  foreignActivation: randomUUID(),
  foreignSession: randomUUID(),
  foreignBill: randomUUID(),
  foreignUser: randomUUID(),
  foreignMembership: randomUUID(),
};
const credentials = {
  guest: `guest-${randomUUID()}-${randomUUID()}`,
  guestCsrf: `csrf-${randomUUID()}-${randomUUID()}`,
  browse: `browse-${randomUUID()}-${randomUUID()}`,
  browseCsrf: `csrf-${randomUUID()}-${randomUUID()}`,
  staff: `staff-${randomUUID()}-${randomUUID()}`,
  staffCsrf: `csrf-${randomUUID()}-${randomUUID()}`,
  noPermission: `staff-${randomUUID()}-${randomUUID()}`,
  noPermissionCsrf: `csrf-${randomUUID()}-${randomUUID()}`,
};
const guestCookie = () => `eatease_guest_session=${encodeURIComponent(credentials.guest)}`;
const browseCookie = () => `eatease_guest_session=${encodeURIComponent(credentials.browse)}`;
const staffCookie = () => `eatease_staff_session=${encodeURIComponent(credentials.staff)}`;
const noPermissionCookie = () =>
  `eatease_staff_session=${encodeURIComponent(credentials.noPermission)}`;
type SubmissionResponse = { data: { order: { id: string } } };
type SessionViewResponse = { data: ConsolidatedSessionView };

describe('M2.9 ordering API on PostgreSQL', () => {
  let application: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let ordering: OrderingService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = module.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new FoundationExceptionFilter());
    await application.init();
    server = application.getHttpServer() as Server;
    prisma = application.get(PrismaService);
    ordering = application.get(OrderingService);
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS "database"
    `;
    if (identity[0]?.database !== target.pathname.slice(1)) {
      throw new Error('Database identity mismatch before M2.9 writes.');
    }

    await prisma.restaurant.createMany({
      data: [
        { id: ids.restaurant, name: 'M2.9 ordering fixture' },
        { id: ids.foreignRestaurant, name: 'M2.9 foreign fixture' },
      ],
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.location,
          restaurantId: ids.restaurant,
          code: `M29-${ids.location.slice(0, 8)}`,
          name: 'M2.9 location',
          isActive: true,
        },
        {
          id: ids.foreignLocation,
          restaurantId: ids.foreignRestaurant,
          code: `M29-${ids.foreignLocation.slice(0, 8)}`,
          name: 'M2.9 foreign location',
          isActive: true,
        },
      ],
    });
    await prisma.staffUser.createMany({
      data: [
        {
          id: ids.staffUser,
          email: `m29-${ids.staffUser}@example.test`,
          passwordHash: 'scrypt$fixture',
          name: 'M2.9 Waiter',
        },
        {
          id: ids.noPermissionUser,
          email: `m29-${ids.noPermissionUser}@example.test`,
          passwordHash: 'scrypt$fixture',
          name: 'M2.9 No Permission',
        },
        {
          id: ids.foreignUser,
          email: `m29-${ids.foreignUser}@example.test`,
          passwordHash: 'scrypt$fixture',
          name: 'M2.9 Foreign Activator',
        },
      ],
    });
    await prisma.staffMembership.createMany({
      data: [
        {
          id: ids.membership,
          staffUserId: ids.staffUser,
          restaurantId: ids.restaurant,
          locationId: ids.location,
        },
        {
          id: ids.noPermissionMembership,
          staffUserId: ids.noPermissionUser,
          restaurantId: ids.restaurant,
          locationId: ids.location,
        },
        {
          id: ids.foreignMembership,
          staffUserId: ids.foreignUser,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
        },
      ],
    });
    const permissions = await Promise.all(
      ['order.create_for_table', 'bill.read'].map((code) =>
        prisma.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );
    await prisma.role.create({
      data: {
        id: ids.role,
        restaurantId: ids.restaurant,
        code: `M29-${ids.role}`,
        name: 'M2.9 Waiter role',
      },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: ids.role,
        permissionId: permission.id,
      })),
    });
    await prisma.membershipRole.create({
      data: { membershipId: ids.membership, roleId: ids.role, restaurantId: ids.restaurant },
    });
    await prisma.restaurantTable.createMany({
      data: [
        {
          id: ids.table,
          publicId: ids.tablePublic,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          code: 'M29-A',
          capacity: 4,
          physicalStatus: 'OCCUPIED',
        },
        {
          id: ids.foreignTable,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
          code: 'M29-F',
          capacity: 4,
          physicalStatus: 'OCCUPIED',
        },
      ],
    });
    await prisma.menuCategory.create({
      data: {
        id: ids.category,
        restaurantId: ids.restaurant,
        locationId: ids.location,
        name: 'M2.9 menu',
        displayOrder: 1,
      },
    });
    await prisma.menuItem.create({
      data: {
        id: ids.item,
        restaurantId: ids.restaurant,
        locationId: ids.location,
        categoryId: ids.category,
        name: 'Historical M2.9 dish',
        priceAmount: 79_000n,
        fulfillmentStation: 'KITCHEN',
      },
    });

    const absoluteExpiresAt = new Date(Date.now() + 8 * 60 * 60_000);
    await prisma.guestSession.createMany({
      data: [
        {
          id: ids.guest,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          tokenHash: hashToken(credentials.guest),
          csrfTokenHash: hashToken(credentials.guestCsrf),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt,
        },
        {
          id: ids.browseGuest,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          tokenHash: hashToken(credentials.browse),
          csrfTokenHash: hashToken(credentials.browseCsrf),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt,
        },
        {
          id: ids.foreignGuest,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
          tableId: ids.foreignTable,
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          csrfTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          idleExpiresAt: new Date(Date.now() + 30 * 60_000),
          absoluteExpiresAt,
        },
      ],
    });
    await prisma.activationRequest.createMany({
      data: [
        {
          id: ids.activation,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          requesterGuestSessionId: ids.guest,
          status: 'APPROVED',
          handledByMembershipId: ids.membership,
          handledAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
          version: 1,
        },
        {
          id: ids.foreignActivation,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
          tableId: ids.foreignTable,
          requesterGuestSessionId: ids.foreignGuest,
          status: 'APPROVED',
          handledByMembershipId: ids.foreignMembership,
          handledAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
          version: 1,
        },
      ],
    });
    await prisma.tableSession.createMany({
      data: [
        {
          id: ids.tableSession,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableId: ids.table,
          activationRequestId: ids.activation,
          activatedByMembershipId: ids.membership,
        },
        {
          id: ids.foreignSession,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
          tableId: ids.foreignTable,
          activationRequestId: ids.foreignActivation,
          activatedByMembershipId: ids.foreignMembership,
        },
      ],
    });
    await prisma.bill.createMany({
      data: [
        {
          id: ids.bill,
          restaurantId: ids.restaurant,
          locationId: ids.location,
          tableSessionId: ids.tableSession,
        },
        {
          id: ids.foreignBill,
          restaurantId: ids.foreignRestaurant,
          locationId: ids.foreignLocation,
          tableSessionId: ids.foreignSession,
        },
      ],
    });
    await prisma.guestSession.update({
      where: { id: ids.guest },
      data: { accessLevel: 'ORDER_ENABLED', tableSessionId: ids.tableSession },
    });
    await prisma.staffSession.createMany({
      data: [
        {
          id: ids.staffSession,
          staffUserId: ids.staffUser,
          membershipId: ids.membership,
          tokenHash: hashToken(credentials.staff),
          csrfTokenHash: hashToken(credentials.staffCsrf),
          expiresAt: absoluteExpiresAt,
        },
        {
          id: ids.noPermissionSession,
          staffUserId: ids.noPermissionUser,
          membershipId: ids.noPermissionMembership,
          tokenHash: hashToken(credentials.noPermission),
          csrfTokenHash: hashToken(credentials.noPermissionCsrf),
          expiresAt: absoluteExpiresAt,
        },
      ],
    });
  });

  afterAll(async () => {
    await application.close();
  });

  const body = (quantity = 1) => ({
    items: [{ menuItemId: ids.item, quantity, modifierSelections: [], note: null }],
  });

  it('submits Guest and Waiter Orders into one Bill and returns the current snapshot preview', async () => {
    const guest = await request(server)
      .post('/api/v1/orders')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', guestCookie())
      .set('X-CSRF-Token', credentials.guestCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body(2))
      .expect(201);
    const staff = await request(server)
      .post(`/api/v1/staff/table-sessions/${ids.tableSession}/orders`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', staffCookie())
      .set('X-CSRF-Token', credentials.staffCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body(1))
      .expect(201);
    const guestBody = guest.body as unknown as SubmissionResponse;
    const staffBody = staff.body as unknown as SubmissionResponse;
    expect(staffBody.data.order.id).not.toBe(guestBody.data.order.id);

    const preview = await request(server)
      .get('/api/v1/table-sessions/current')
      .set('Cookie', guestCookie())
      .expect(200);
    const previewBody = preview.body as unknown as SessionViewResponse;
    expect(previewBody.data.orders).toHaveLength(2);
    expect(previewBody.data.bill.lines).toHaveLength(2);
    expect(previewBody.data.bill.totalAmount).toBe('237000');
    expect(previewBody.data.bill.lines[0]?.descriptionSnapshot).toBe('Historical M2.9 dish');

    const staffPreview = await request(server)
      .get(`/api/v1/staff/table-sessions/${ids.tableSession}/bill`)
      .set('Cookie', staffCookie())
      .expect(200);
    const staffPreviewBody = staffPreview.body as unknown as SessionViewResponse;
    expect(staffPreviewBody.data.bill.totalAmount).toBe('237000');
  });

  it('replays identical retries, rejects payload conflicts, and prevents concurrent duplicates', async () => {
    const key = randomUUID();
    const submit = (quantity: number) =>
      request(server)
        .post('/api/v1/orders')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', guestCookie())
        .set('X-CSRF-Token', credentials.guestCsrf)
        .set('Idempotency-Key', key)
        .send(body(quantity));
    const [first, second] = await Promise.all([submit(1).expect(201), submit(1).expect(201)]);
    const firstBody = first.body as unknown as SubmissionResponse;
    const secondBody = second.body as unknown as SubmissionResponse;
    expect(secondBody.data.order.id).toBe(firstBody.data.order.id);
    await submit(2).expect(409);
    expect(await prisma.order.count({ where: { id: firstBody.data.order.id } })).toBe(1);
  });

  it('denies missing security controls, browse-only access, missing permission and wrong scope', async () => {
    await request(server).post('/api/v1/orders').send(body()).expect(401);
    await request(server)
      .post('/api/v1/orders')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', guestCookie())
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
    await request(server)
      .post('/api/v1/orders')
      .set('Origin', 'https://untrusted.example')
      .set('Cookie', guestCookie())
      .set('X-CSRF-Token', credentials.guestCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
    await request(server)
      .post('/api/v1/orders')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', browseCookie())
      .set('X-CSRF-Token', credentials.browseCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
    await request(server)
      .post(`/api/v1/staff/table-sessions/${ids.tableSession}/orders`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', noPermissionCookie())
      .set('X-CSRF-Token', credentials.noPermissionCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
    await request(server)
      .post(`/api/v1/staff/table-sessions/${ids.foreignSession}/orders`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', staffCookie())
      .set('X-CSRF-Token', credentials.staffCsrf)
      .set('Idempotency-Key', randomUUID())
      .send(body())
      .expect(403);
  });

  it('rejects client price tampering and transactionally revalidates the Staff Session', async () => {
    await request(server)
      .post('/api/v1/orders')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', guestCookie())
      .set('X-CSRF-Token', credentials.guestCsrf)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body(), totalAmount: '1' })
      .expect(400);

    const stalePrincipal: StaffPrincipal = {
      sessionId: ids.staffSession,
      staffUserId: ids.staffUser,
      membershipId: ids.membership,
      restaurantId: ids.restaurant,
      locationId: ids.location,
      email: `m29-${ids.staffUser}@example.test`,
      name: 'M2.9 Waiter',
      permissions: ['order.create_for_table'],
      csrfTokenHash: hashToken(credentials.staffCsrf),
    };
    await prisma.staffSession.update({
      where: { id: ids.staffSession },
      data: { revokedAt: new Date() },
    });
    await expect(
      ordering.submitStaff(stalePrincipal, ids.tableSession, body(), randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
  });
});
