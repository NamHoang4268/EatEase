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
      TRUSTED_WEB_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY_HOPS: 0,
    });
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
