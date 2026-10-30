import { z } from 'zod';
import { catalogFixtureIds } from '../src/catalog/catalog.fixtures.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MANAGED_CONFIRMATION_FLAG = '--allow-managed';

const managedInputSchema = z.object({
  databaseUrl: z.url().startsWith('postgresql://'),
  expectedHost: z.string().trim().min(1),
  expectedDatabase: z.literal('neondb'),
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(160),
  password: z.string().min(12).max(256),
  locationId: z.uuid(),
});

export type ManagedStaffBootstrapInput = z.infer<typeof managedInputSchema> & {
  expectedRestaurantId: string;
};

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

export function assertLocalStaffBootstrapTarget(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      'Staff bootstrap is restricted to a local database. Managed targets require a separate owner-approved operation.',
    );
  }
}

export function parseManagedStaffBootstrapInput(
  source: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): ManagedStaffBootstrapInput {
  if (!args.includes(MANAGED_CONFIRMATION_FLAG)) {
    throw new Error('Managed staff bootstrap requires explicit --allow-managed confirmation.');
  }

  const input = managedInputSchema.parse({
    databaseUrl: source.DIRECT_DATABASE_URL,
    expectedHost: source.STAFF_BOOTSTRAP_EXPECTED_HOST,
    expectedDatabase: source.STAFF_BOOTSTRAP_EXPECTED_DATABASE,
    email: source.STAFF_BOOTSTRAP_EMAIL,
    name: source.STAFF_BOOTSTRAP_NAME,
    password: source.STAFF_BOOTSTRAP_PASSWORD,
    locationId: source.STAFF_BOOTSTRAP_LOCATION_ID,
  });
  const url = new URL(input.databaseUrl);
  const hostname = url.hostname.toLowerCase();
  const expectedHost = input.expectedHost.toLowerCase();

  if (LOCAL_HOSTS.has(hostname)) {
    throw new Error('Managed staff bootstrap refuses localhost and loopback targets.');
  }
  if (hostname.includes('pooler')) {
    throw new Error('Managed staff bootstrap requires a direct, non-pooler database endpoint.');
  }
  if (!hostname.endsWith('.neon.tech')) {
    throw new Error('Managed staff bootstrap requires a Neon database endpoint.');
  }
  if (hostname !== expectedHost) {
    throw new Error('DIRECT_DATABASE_URL hostname does not match STAFF_BOOTSTRAP_EXPECTED_HOST.');
  }
  if (databaseName(url) !== input.expectedDatabase) {
    throw new Error('DIRECT_DATABASE_URL database does not match the expected neondb database.');
  }
  if (input.locationId !== catalogFixtureIds.location) {
    throw new Error('Managed staff bootstrap requires the deterministic synthetic location UUID.');
  }

  return {
    ...input,
    expectedRestaurantId: catalogFixtureIds.restaurant,
  };
}
