import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  TRUSTED_WEB_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value, context) => {
      const origins = [
        ...new Set(
          value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        ),
      ];
      if (origins.length === 0 || origins.some((origin) => !isValidOrigin(origin))) {
        context.addIssue({ code: 'custom', message: 'Must contain absolute HTTP(S) origins' });
        return z.NEVER;
      }
      return origins;
    }),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

function isValidOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

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
