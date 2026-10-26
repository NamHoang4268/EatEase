import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Environment {
  const result = environmentSchema.safeParse({
    ...source,
    API_PORT: source.PORT ?? source.API_PORT,
  });
  if (!result.success) {
    throw new Error(`Invalid API environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
