import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GuestCookieService } from './guest-cookie.service.js';
import { GuestSessionGuard } from './guest-session.guard.js';
import type { GuestSessionService } from './guest-session.service.js';

function createMockContext(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('GuestSessionGuard', () => {
  it('allows request when valid session cookie exists and populates principal', async () => {
    const mockPrincipal = {
      sessionId: 'session-1',
      restaurantId: 'rest-1',
      locationId: 'loc-1',
      tableId: 'table-1',
      tablePublicId: 'pub-1',
      accessLevel: 'BROWSE_ONLY' as const,
      idleExpiresAt: new Date(Date.now() + 10000),
      absoluteExpiresAt: new Date(Date.now() + 20000),
      csrfTokenHash: 'hash',
    };

    const cookieService: GuestCookieService = {
      read: vi.fn().mockReturnValue('valid-token'),
    } as unknown as GuestCookieService;

    const sessionService: GuestSessionService = {
      authenticate: vi.fn().mockResolvedValue(mockPrincipal),
    } as unknown as GuestSessionService;

    const guard = new GuestSessionGuard(cookieService, sessionService);
    const request = {} as { guestPrincipal?: unknown };
    const context = createMockContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.guestPrincipal).toBe(mockPrincipal);
  });

  it('rejects request when cookie is missing or session is invalid', async () => {
    const cookieService: GuestCookieService = {
      read: vi.fn().mockReturnValue(undefined),
    } as unknown as GuestCookieService;

    const sessionService: GuestSessionService = {
      authenticate: vi.fn().mockResolvedValue(null),
    } as unknown as GuestSessionService;

    const guard = new GuestSessionGuard(cookieService, sessionService);
    const context = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});

