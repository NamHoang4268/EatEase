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
});
