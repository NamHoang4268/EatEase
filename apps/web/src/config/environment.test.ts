import { describe, expect, it } from 'vitest';
import { loadServerEnvironment } from './environment';

describe('loadServerEnvironment', () => {
  it('provides the local API default', () => {
    expect(loadServerEnvironment({})).toEqual({ API_INTERNAL_URL: 'http://localhost:3001' });
  });

  it('rejects an invalid URL', () => {
    expect(() => loadServerEnvironment({ API_INTERNAL_URL: 'api' })).toThrow(
      'Invalid web environment',
    );
  });

  it('requires an explicit API target in production', () => {
    expect(() => loadServerEnvironment({ NODE_ENV: 'production' })).toThrow(
      'Invalid web environment',
    );
  });
});
