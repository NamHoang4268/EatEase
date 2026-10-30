import { describe, expect, it } from 'vitest';
import { catalogFixtureIds } from '../src/catalog/catalog.fixtures.js';
import {
  assertLocalStaffBootstrapTarget,
  parseManagedStaffBootstrapInput,
} from './staff-bootstrap-targets.js';

const directHost = 'ep-eatease-demo.ap-southeast-1.aws.neon.tech';
const baseEnvironment = {
  DIRECT_DATABASE_URL: `postgresql://demo:secret@${directHost}/neondb?sslmode=require`,
  STAFF_BOOTSTRAP_EXPECTED_HOST: directHost,
  STAFF_BOOTSTRAP_EXPECTED_DATABASE: 'neondb',
  STAFF_BOOTSTRAP_EMAIL: 'manager@demo.eatease.invalid',
  STAFF_BOOTSTRAP_NAME: 'EatEase Demo Manager',
  STAFF_BOOTSTRAP_PASSWORD: 'not-a-real-demo-password',
  STAFF_BOOTSTRAP_LOCATION_ID: catalogFixtureIds.location,
} as const;

describe('managed staff bootstrap targeting', () => {
  it('requires explicit managed authorization before validating environment values', () => {
    expect(() => parseManagedStaffBootstrapInput({}, [])).toThrow(/--allow-managed/);
  });

  it('accepts only the exact confirmed direct host, database and synthetic location', () => {
    const result = parseManagedStaffBootstrapInput(baseEnvironment, ['--allow-managed']);

    expect(result).toMatchObject({
      expectedHost: directHost,
      expectedDatabase: 'neondb',
      expectedRestaurantId: catalogFixtureIds.restaurant,
      locationId: catalogFixtureIds.location,
      email: 'manager@demo.eatease.invalid',
    });
  });

  it.each([
    [
      'hostname mismatch',
      { STAFF_BOOTSTRAP_EXPECTED_HOST: 'another-project.neon.tech' },
      /hostname does not match/,
    ],
    [
      'database mismatch',
      { DIRECT_DATABASE_URL: `postgresql://demo:secret@${directHost}/otherdb?sslmode=require` },
      /database does not match/,
    ],
    [
      'pooler endpoint',
      {
        DIRECT_DATABASE_URL:
          'postgresql://demo:secret@ep-eatease-demo-pooler.ap-southeast-1.aws.neon.tech/neondb',
        STAFF_BOOTSTRAP_EXPECTED_HOST: 'ep-eatease-demo-pooler.ap-southeast-1.aws.neon.tech',
      },
      /non-pooler/,
    ],
    [
      'non-Neon endpoint',
      {
        DIRECT_DATABASE_URL: 'postgresql://demo:secret@database.example.com/neondb',
        STAFF_BOOTSTRAP_EXPECTED_HOST: 'database.example.com',
      },
      /Neon database endpoint/,
    ],
    [
      'wrong synthetic location',
      { STAFF_BOOTSTRAP_LOCATION_ID: '20000000-0000-4000-8000-000000000099' },
      /synthetic location UUID/,
    ],
  ])('rejects %s', (_name, overrides, expected) => {
    expect(() =>
      parseManagedStaffBootstrapInput({ ...baseEnvironment, ...overrides }, ['--allow-managed']),
    ).toThrow(expected);
  });

  it('rejects loopback targets and preserves the local-only guard', () => {
    expect(() =>
      parseManagedStaffBootstrapInput(
        {
          ...baseEnvironment,
          DIRECT_DATABASE_URL: 'postgresql://demo:secret@127.0.0.1/neondb',
          STAFF_BOOTSTRAP_EXPECTED_HOST: '127.0.0.1',
        },
        ['--allow-managed'],
      ),
    ).toThrow(/localhost and loopback/);

    expect(() =>
      assertLocalStaffBootstrapTarget('postgresql://demo:secret@localhost:5432/eatease'),
    ).not.toThrow();
    expect(() =>
      assertLocalStaffBootstrapTarget(`postgresql://demo:secret@${directHost}/neondb`),
    ).toThrow(/restricted to a local database/);
  });
});
