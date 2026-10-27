import { Injectable } from '@nestjs/common';
import { LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_MS } from './auth.constants.js';

type FailureRecord = { count: number; windowStartedAt: number };

@Injectable()
export class LoginRateLimiterService {
  private readonly failures = new Map<string, FailureRecord>();

  isBlocked(key: string, now = Date.now()): boolean {
    const record = this.currentRecord(key, now);
    return record !== undefined && record.count >= LOGIN_FAILURE_LIMIT;
  }

  recordFailure(key: string, now = Date.now()): void {
    const record = this.currentRecord(key, now);
    this.failures.set(
      key,
      record ? { ...record, count: record.count + 1 } : { count: 1, windowStartedAt: now },
    );
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private currentRecord(key: string, now: number): FailureRecord | undefined {
    const record = this.failures.get(key);
    if (record && now - record.windowStartedAt >= LOGIN_FAILURE_WINDOW_MS) {
      this.failures.delete(key);
      return undefined;
    }
    return record;
  }
}
