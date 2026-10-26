import { z } from 'zod';

const serverEnvironmentSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://localhost:3001'),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function loadServerEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid web environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
