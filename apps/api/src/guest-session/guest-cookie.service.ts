import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { loadEnvironment } from '../config/environment.js';
import { readCookie } from '../staff-auth/staff-cookie.service.js';
import { GUEST_SESSION_COOKIE } from './guest-session.constants.js';

export function guestCookieOptions(nodeEnvironment: string, maxAgeMs?: number): CookieOptions {
  const production = nodeEnvironment === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}

@Injectable()
export class GuestCookieService {
  read(request: Request): string | undefined {
    return readCookie(request, GUEST_SESSION_COOKIE);
  }

  set(response: Response, rawToken: string, expiresAt: Date, now = new Date()): void {
    let nodeEnv = 'development';
    try {
      nodeEnv = loadEnvironment().NODE_ENV;
    } catch {
      nodeEnv = process.env.NODE_ENV ?? 'development';
    }
    const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
    const options = guestCookieOptions(nodeEnv, remainingMs);
    response.cookie(GUEST_SESSION_COOKIE, rawToken, options);
  }

  clear(response: Response): void {
    let nodeEnv = 'development';
    try {
      nodeEnv = loadEnvironment().NODE_ENV;
    } catch {
      nodeEnv = process.env.NODE_ENV ?? 'development';
    }
    const options = guestCookieOptions(nodeEnv);
    delete options.maxAge;
    response.clearCookie(GUEST_SESSION_COOKIE, options);
  }
}
