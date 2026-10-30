import { describe, expect, it } from 'vitest';
import { loadServerEnvironment } from './environment';

describe('loadServerEnvironment', () => {
  it('provides the local API default', () => {
    expect(loadServerEnvironment({})).toEqual({
      NODE_ENV: 'development',
      API_INTERNAL_URL: 'http://localhost:3001',
    });
  });

  it('rejects an invalid URL', () => {
    expect(() => loadServerEnvironment({ API_INTERNAL_URL: 'api' })).toThrow(
      'Invalid web environment',
    );
  });

  it('requires an explicit API target and proxy secret in production', () => {
    expect(() => loadServerEnvironment({ NODE_ENV: 'production' })).toThrow(
      'Invalid web environment',
    );
    expect(() =>
      loadServerEnvironment({
        NODE_ENV: 'production',
        API_INTERNAL_URL: 'https://api.example.test',
        API_PROXY_SHARED_SECRET: 'local-only-api-proxy-shared-secret-change-me',
      }),
    ).toThrow('Invalid web environment');
    expect(
      loadServerEnvironment({
        NODE_ENV: 'production',
        API_INTERNAL_URL: 'https://api.example.test',
        API_PROXY_SHARED_SECRET: 'production-api-proxy-secret-at-least-32-characters',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });
});
