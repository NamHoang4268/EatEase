import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { loadEnvironment } from '../config/environment.js';
import { STAFF_SESSION_COOKIE, STAFF_SESSION_TTL_MS } from './auth.constants.js';

export function staffCookieOptions(nodeEnvironment: string): CookieOptions {
  const production = nodeEnvironment === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/',
    maxAge: STAFF_SESSION_TTL_MS,
  };
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Injectable()
export class StaffCookieService {
  private readonly options = staffCookieOptions(loadEnvironment().NODE_ENV);

  read(request: Request): string | undefined {
    return readCookie(request, STAFF_SESSION_COOKIE);
  }

  set(response: Response, rawToken: string): void {
    response.cookie(STAFF_SESSION_COOKIE, rawToken, this.options);
  }

  clear(response: Response): void {
    const clearOptions = { ...this.options };
    delete clearOptions.maxAge;
    response.clearCookie(STAFF_SESSION_COOKIE, clearOptions);
  }
}
