import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import {
  GuestAccessLevel,
  RestaurantStatus,
  TablePhysicalStatus,
} from '../generated/prisma/enums.js';
import { GuestSessionService } from './guest-session.service.js';

describe('GuestSessionService', () => {
  const mockTable = {
    id: 'table-1',
    restaurantId: 'rest-1',
    locationId: 'loc-1',
    publicId: '31000000-0000-4000-8000-000000000001',
    code: 'A01',
    capacity: 2,
    physicalStatus: TablePhysicalStatus.AVAILABLE,
    location: {
      name: 'Chi nhánh Demo',
      restaurant: { name: 'Bếp Mây Demo' },
    },
  };

  it('throws NotFoundException when table does not exist or is inactive', async () => {
    const prisma = {
      restaurantTable: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const service = new GuestSessionService(prisma);
    await expect(
      service.bootstrapSession({ tablePublicId: '31000000-0000-4000-8000-000000000099' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('creates a new BROWSE_ONLY session when no valid existing session is provided', async () => {
    const prisma = {
      restaurantTable: { findFirst: vi.fn().mockResolvedValue(mockTable) },
      guestSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-session-id' }),
      },
    } as unknown as PrismaService;

    const service = new GuestSessionService(prisma);
    const now = new Date('2026-10-28T12:00:00Z');
    const result = await service.bootstrapSession(
      { tablePublicId: mockTable.publicId },
      undefined,
      now,
    );

    expect(result.accessLevel).toBe(GuestAccessLevel.BROWSE_ONLY);
    expect(result.activationState).toBe('NOT_REQUESTED');
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.table.tableLabel).toBe('A01');
    expect(result.table.availability).toBe('AVAILABLE');

    // 30 min idle, 8 hr absolute
    expect(result.idleExpiresAt.toISOString()).toBe('2026-10-28T12:30:00.000Z');
    expect(result.absoluteExpiresAt.toISOString()).toBe('2026-10-28T20:00:00.000Z');
  });

  it('reuses existing valid session on the same table and updates idle expiry and CSRF token', async () => {
    const existingRaw = 'existing-raw-token';
    const now = new Date('2026-10-28T12:15:00Z');
    const originalAbsolute = new Date('2026-10-28T20:00:00Z');
    const updateSpy = vi.fn().mockResolvedValue({ id: 'existing-id' });

    const prisma = {
      restaurantTable: { findFirst: vi.fn().mockResolvedValue(mockTable) },
      guestSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'existing-id',
          tableId: mockTable.id,
          accessLevel: GuestAccessLevel.BROWSE_ONLY,
          idleExpiresAt: new Date('2026-10-28T12:30:00Z'),
          absoluteExpiresAt: originalAbsolute,
          revokedAt: null,
        }),
        update: updateSpy,
      },
    } as unknown as PrismaService;

    const service = new GuestSessionService(prisma);
    const result = await service.bootstrapSession(
      { tablePublicId: mockTable.publicId },
      existingRaw,
      now,
    );

    expect(result.sessionToken).toBe(existingRaw);
    expect(result.idleExpiresAt.toISOString()).toBe('2026-10-28T12:45:00.000Z');
    expect(result.absoluteExpiresAt.toISOString()).toBe('2026-10-28T20:00:00.000Z');
    expect(updateSpy).toHaveBeenCalled();
  });

  it('creates a new session if existing session belongs to a different table', async () => {
    const existingRaw = 'other-table-token';
    const now = new Date('2026-10-28T12:00:00Z');
    const createSpy = vi.fn().mockResolvedValue({ id: 'new-session-id' });

    const prisma = {
      restaurantTable: { findFirst: vi.fn().mockResolvedValue(mockTable) },
      guestSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'other-session-id',
          tableId: 'different-table-id',
          accessLevel: GuestAccessLevel.BROWSE_ONLY,
          idleExpiresAt: new Date('2026-10-28T12:30:00Z'),
          absoluteExpiresAt: new Date('2026-10-28T20:00:00Z'),
          revokedAt: null,
        }),
        create: createSpy,
      },
    } as unknown as PrismaService;

    const service = new GuestSessionService(prisma);
    const result = await service.bootstrapSession(
      { tablePublicId: mockTable.publicId },
      existingRaw,
      now,
    );

    expect(result.sessionToken).not.toBe(existingRaw);
    expect(createSpy).toHaveBeenCalled();
  });

  it('rejects expired or revoked session in authenticate', async () => {
    const prisma = {
      guestSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-id',
          revokedAt: new Date('2026-10-28T11:59:00Z'),
          idleExpiresAt: new Date('2026-10-28T12:30:00Z'),
          absoluteExpiresAt: new Date('2026-10-28T20:00:00Z'),
          table: {
            isActive: true,
            location: {
              isActive: true,
              restaurant: { status: RestaurantStatus.ACTIVE },
            },
          },
        }),
      },
    } as unknown as PrismaService;

    const service = new GuestSessionService(prisma);
    const result = await service.authenticate('any-token', new Date('2026-10-28T12:00:00Z'));
    expect(result).toBeNull();
  });
});
