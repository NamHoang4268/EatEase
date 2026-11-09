import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalE2eDatabase } from './e2e/local-target.js';

assertLocalE2eDatabase(); // Fail closed before starting servers or writing fixtures.
const diagnostics = process.env.E2E_NETWORK_DIAGNOSTICS === '1';
const webDiagnostics = diagnostics
  ? {
      EATEASE_E2E_SERVER_DIAGNOSTICS: '1',
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        '--trace-warnings',
        `--import=${pathToFileURL(join(import.meta.dirname, 'e2e/server-diagnostics.ts')).href}`,
      ]
        .filter(Boolean)
        .join(' '),
    }
  : {};
const env = {
  NODE_ENV: 'development',
  DOTENV_CONFIG_PATH: join(tmpdir(), `eatease-e2e-${randomUUID()}.missing`),
  DATABASE_URL: process.env.DATABASE_URL!,
  JOIN_CODE_HASH_SECRET: 'synthetic-local-e2e-join-code-secret-only',
  API_PROXY_SHARED_SECRET: 'synthetic-local-e2e-api-proxy-secret-only',
  REALTIME_ENABLED: 'true',
  OUTBOX_PUBLISHER_ENABLED: 'true',
  REALTIME_PUBLIC_URL: 'http://127.0.0.1:3101',
  TRUSTED_WEB_ORIGINS: 'http://localhost:3100',
  API_PORT: '3101',
  PORT: '3101',
  OUTBOX_POLL_MS: '250',
  OUTBOX_BATCH_SIZE: '50',
  API_INTERNAL_URL: 'http://127.0.0.1:3101',
  NEXT_PUBLIC_REALTIME_ENABLED: 'true',
  NEXT_DIST_DIR: '.next-e2e',
};
// Workers and both child servers use the same explicit local-only settings.
Object.assign(process.env, env);
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: diagnostics ? [['list'], ['./e2e/diagnostic-reporter.ts']] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:3100',
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      // Playwright supervises this process; watch mode can stall before bootstrap on Windows.
      command: 'pnpm exec tsx src/main.ts',
      name: 'API',
      stdout: 'pipe',
      stderr: 'pipe',
      url: 'http://127.0.0.1:3101/api/v1/health/ready',
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @eatease/web exec next dev --port 3100',
      name: 'Web',
      stdout: 'pipe',
      stderr: 'pipe',
      url: 'http://localhost:3100/health',
      env: { ...env, PORT: '3100', ...webDiagnostics },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
