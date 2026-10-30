import { z } from 'zod';

const API_PROXY_SHARED_SECRET_PLACEHOLDER = 'local-only-api-proxy-shared-secret-change-me';

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_INTERNAL_URL: z.url(),
    API_PROXY_SHARED_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      (!value.API_PROXY_SHARED_SECRET ||
        value.API_PROXY_SHARED_SECRET === API_PROXY_SHARED_SECRET_PLACEHOLDER)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['API_PROXY_SHARED_SECRET'],
        message: 'A non-placeholder proxy secret is required in production',
      });
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function loadServerEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    API_INTERNAL_URL:
      source.API_INTERNAL_URL ??
      (source.NODE_ENV === 'production' ? undefined : 'http://localhost:3001'),
    API_PROXY_SHARED_SECRET: source.API_PROXY_SHARED_SECRET,
  });
  if (!result.success) {
    throw new Error(`Invalid web environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
