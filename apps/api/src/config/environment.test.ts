import { describe, expect, it } from 'vitest';
import { loadEnvironment } from './environment.js';

describe('loadEnvironment', () => {
  it('parses a valid environment', () => {
    expect(
      loadEnvironment({
        NODE_ENV: 'test',
        API_PORT: '3101',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        DATABASE_POOL_MAX: '7',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      API_PORT: 3101,
      DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
      DATABASE_POOL_MAX: 7,
      GUEST_IDLE_TIMEOUT_MINUTES: 30,
      GUEST_ABSOLUTE_TIMEOUT_HOURS: 8,
      ACTIVATION_REQUEST_TTL_MINUTES: 5,
      GUEST_CLAIM_RECOVERY_TTL_SECONDS: 120,
      JOIN_CODE_TTL_MINUTES: 30,
      JOIN_RECOVERY_TTL_SECONDS: 120,
      TRUSTED_WEB_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY_HOPS: 0,
    });
  });

  it('parses custom guest timeout configurations', () => {
    expect(
      loadEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        GUEST_IDLE_TIMEOUT_MINUTES: '45',
        GUEST_ABSOLUTE_TIMEOUT_HOURS: '12',
        ACTIVATION_REQUEST_TTL_MINUTES: '10',
        GUEST_CLAIM_RECOVERY_TTL_SECONDS: '180',
        JOIN_CODE_TTL_MINUTES: '45',
        JOIN_RECOVERY_TTL_SECONDS: '180',
      }),
    ).toMatchObject({
      GUEST_IDLE_TIMEOUT_MINUTES: 45,
      GUEST_ABSOLUTE_TIMEOUT_HOURS: 12,
      ACTIVATION_REQUEST_TTL_MINUTES: 10,
      GUEST_CLAIM_RECOVERY_TTL_SECONDS: 180,
      JOIN_CODE_TTL_MINUTES: 45,
      JOIN_RECOVERY_TTL_SECONDS: 180,
    });
  });

  it('rejects claim recovery TTL values outside the approved range', () => {
    expect(() =>
      loadEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        GUEST_CLAIM_RECOVERY_TTL_SECONDS: '29',
      }),
    ).toThrow('Invalid API environment');
    expect(() =>
      loadEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        GUEST_CLAIM_RECOVERY_TTL_SECONDS: '301',
      }),
    ).toThrow('Invalid API environment');
  });

  it('uses the platform PORT when provided', () => {
    expect(
      loadEnvironment({
        PORT: '10000',
        API_PORT: '3001',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
      }).API_PORT,
    ).toBe(10000);
  });

  it('fails fast when required settings are invalid', () => {
    expect(() => loadEnvironment({ API_PORT: 'invalid' })).toThrow('Invalid API environment');
  });

  it('requires a dedicated Join Code hash secret in production', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
      }),
    ).toThrow('Invalid API environment');
    expect(
      loadEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        JOIN_CODE_HASH_SECRET: 'production-join-code-secret-at-least-32-characters',
      }).JOIN_CODE_HASH_SECRET,
    ).toBe('production-join-code-secret-at-least-32-characters');
  });

  it('parses an explicit origin allowlist and rejects wildcard origins', () => {
    expect(
      loadEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        TRUSTED_WEB_ORIGINS: 'http://localhost:3000,https://eat-ease.vercel.app',
      }).TRUSTED_WEB_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://eat-ease.vercel.app']);
    expect(() =>
      loadEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
        TRUSTED_WEB_ORIGINS: '*',
      }),
    ).toThrow('Invalid API environment');
  });
});
