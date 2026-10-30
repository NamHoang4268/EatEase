import { z } from 'zod';

const JOIN_CODE_HASH_SECRET_PLACEHOLDER = 'replace-with-at-least-32-random-characters';
const API_PROXY_SHARED_SECRET_PLACEHOLDER = 'local-only-api-proxy-shared-secret-change-me';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z.url().startsWith('postgresql://'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    GUEST_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    GUEST_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(72).default(8),
    ACTIVATION_REQUEST_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
    GUEST_CLAIM_RECOVERY_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(120),
    JOIN_CODE_HASH_SECRET: z.string().min(32).optional(),
    API_PROXY_SHARED_SECRET: z.string().min(32).optional(),
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
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.JOIN_CODE_HASH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JOIN_CODE_HASH_SECRET'],
        message: 'Required in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.JOIN_CODE_HASH_SECRET === JOIN_CODE_HASH_SECRET_PLACEHOLDER
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JOIN_CODE_HASH_SECRET'],
        message: 'Placeholder value is not allowed in production',
      });
    }
    if (value.NODE_ENV === 'production' && !value.API_PROXY_SHARED_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['API_PROXY_SHARED_SECRET'],
        message: 'Required in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.API_PROXY_SHARED_SECRET === API_PROXY_SHARED_SECRET_PLACEHOLDER
    ) {
      context.addIssue({
        code: 'custom',
        path: ['API_PROXY_SHARED_SECRET'],
        message: 'Placeholder value is not allowed in production',
      });
    }
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
