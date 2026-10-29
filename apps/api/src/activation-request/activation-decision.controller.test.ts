import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { StaffRequest } from '../staff-auth/staff-auth.types.js';
import { ActivationDecisionService } from './activation-decision.service.js';
import { ActivationRequestService } from './activation-request.service.js';
import { StaffActivationRequestController } from './activation-request.controller.js';

const activationRequestId = 'b7000000-0000-4000-8000-000000000001';
const principal = {
  sessionId: 'b8000000-0000-4000-8000-000000000001',
  staffUserId: 'b4000000-0000-4000-8000-000000000001',
  membershipId: 'b5000000-0000-4000-8000-000000000001',
  restaurantId: 'b1000000-0000-4000-8000-000000000001',
  locationId: 'b2000000-0000-4000-8000-000000000001',
  email: 'staff@example.test',
  name: 'Staff',
  permissions: ['table.activation.approve'],
  csrfTokenHash: 'a'.repeat(64),
} as const;

describe('StaffActivationRequestController decisions', () => {
  const approve = vi.fn();
  const reject = vi.fn();
  const decisions = { approve, reject } as unknown as ActivationDecisionService;
  const requests = {} as ActivationRequestService;
  const controller = new StaffActivationRequestController(requests, decisions);
  const request = { staffPrincipal: principal } as unknown as StaffRequest;

  it('requires explicit physical-presence confirmation before calling the service', async () => {
    await expect(
      controller.approve(
        activationRequestId,
        { expectedVersion: 0, physicalPresenceConfirmed: false },
        'approve-key',
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(approve).not.toHaveBeenCalled();
  });

  it('passes the authenticated principal and normalized rejection reason', async () => {
    reject.mockResolvedValueOnce({
      activationRequest: {
        id: activationRequestId,
        status: 'REJECTED',
        version: 1,
        handledAt: '2026-10-29T00:00:00.000Z',
        rejectionReason: 'No guest present',
      },
    });

    await controller.reject(
      activationRequestId,
      { expectedVersion: 0, reason: '  No guest present  ' },
      'reject-key',
      request,
    );

    expect(reject).toHaveBeenCalledWith({
      activationRequestId,
      expectedVersion: 0,
      reason: 'No guest present',
      idempotencyKey: 'reject-key',
      principal,
    });
  });
});
