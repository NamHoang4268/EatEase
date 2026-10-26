import { z } from 'zod';

const serverEnvironmentSchema = z.object({ API_INTERNAL_URL: z.url() });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function loadServerEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse({
    API_INTERNAL_URL:
      source.API_INTERNAL_URL ??
      (source.NODE_ENV === 'production' ? undefined : 'http://localhost:3001'),
  });
  if (!result.success) {
    throw new Error(`Invalid web environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
