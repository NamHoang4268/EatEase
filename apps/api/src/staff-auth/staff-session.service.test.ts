import { Test } from '@nestjs/testing';
import { expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { hashToken } from './auth.crypto.js';
import { StaffSessionService } from './staff-session.service.js';

it('resolves Prisma through an explicit Nest injection token when creating a staff session', async () => {
  const create = vi.fn().mockResolvedValue({});
  const module = await Test.createTestingModule({
    providers: [
      StaffSessionService,
      { provide: PrismaService, useValue: { staffSession: { create } } },
    ],
  }).compile();
  try {
    const id = '31000000-0000-4000-8000-000000000001';
    const result = await module.get(StaffSessionService).create({
      id,
      email: 'synthetic@example.test',
      name: 'Synthetic staff',
      membershipId: id,
      restaurantId: id,
      locationId: id,
      permissions: ['bill.read'],
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: {
        staffUserId: id,
        membershipId: id,
        tokenHash: hashToken(result.sessionToken),
        csrfTokenHash: hashToken(result.csrfToken),
        expiresAt: result.expiresAt,
      },
    });
  } finally {
    await module.close();
  }
});
