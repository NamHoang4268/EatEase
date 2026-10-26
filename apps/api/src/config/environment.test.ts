import { describe, expect, it } from 'vitest';
import { loadEnvironment } from './environment.js';

describe('loadEnvironment', () => {
  it('parses a valid environment', () => {
    expect(
      loadEnvironment({
        NODE_ENV: 'test',
        API_PORT: '3101',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      API_PORT: 3101,
      DATABASE_URL: 'postgresql://user:password@localhost:5432/eatease',
    });
  });

  it('fails fast when required settings are invalid', () => {
    expect(() => loadEnvironment({ API_PORT: 'invalid' })).toThrow('Invalid API environment');
  });
});
