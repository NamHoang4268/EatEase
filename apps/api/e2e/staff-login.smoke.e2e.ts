import { test, expect } from '@playwright/test';
import { createFixture } from './fixture.js';

test('Staff login navigation and authenticated refresh remain stable', async ({ browser }) => {
  const fixture = await createFixture();
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  try {
    await context.route('**/*', (route) =>
      ['http://localhost:3100', 'http://127.0.0.1:3101'].includes(
        new URL(route.request().url()).origin,
      )
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    await page.routeWebSocket('**/socket.io/**', (route) => {
      route.connectToServer();
    });
    let documents = 0;
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents++;
    });
    await page.goto('/staff/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.manager.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
    await page.getByPlaceholder('UUID địa điểm').fill(fixture.scope.locationId);
    const login = page.waitForResponse(
      (response) =>
        response.url().endsWith('/staff/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
    expect(documents).toBe(1);
    const csrf = page.waitForResponse(
      (response) =>
        response.url().endsWith('/staff/auth/csrf-token') && response.request().method() === 'POST',
    );
    await page.reload();
    expect((await csrf).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
    expect(documents).toBe(2);
    await expect(page).toHaveURL('http://localhost:3100/staff/login');
  } finally {
    await context.close();
    await fixture.close();
  }
});
