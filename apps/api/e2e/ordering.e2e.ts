import {
  test,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
  type WebSocketRoute,
} from '@playwright/test';
import { createFixture, type Fixture } from './fixture.js';

const WEB = 'http://localhost:3100';
type Observation = { hints: string[]; connections: number; drop: boolean; socket?: WebSocketRoute };
async function observe(page: Page) {
  const state: Observation = { hints: [], connections: 0, drop: false };
  await page.routeWebSocket('**/socket.io/**', (route) => {
    state.socket = route;
    const server = route.connectToServer(); // Real API connection; only notification interruption is injected.
    server.onMessage((message) => {
      if (typeof message === 'string') {
        if (message.startsWith('40')) state.connections++;
        if (message.startsWith('42')) {
          const [name, value] = JSON.parse(message.slice(2)) as [string, { type: string }];
          if (name === 'invalidate') {
            state.hints.push(value.type);
            if (state.drop) return;
          }
        }
      }
      route.send(message);
    });
  });
  return state;
}
async function open(browser: Browser, contexts: BrowserContext[]) {
  const context = await browser.newContext({ baseURL: WEB });
  contexts.push(context);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['http://localhost:3100', 'http://127.0.0.1:3101'].includes(url.origin)
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  return { page, context, realtime: await observe(page) };
}
async function login(page: Page, f: Fixture, kind: 'manager' | 'kitchen') {
  await page.goto('/staff/login');
  await page.getByLabel('Email', { exact: true }).fill(f[kind].email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(f.password);
  await page.getByPlaceholder('UUID địa điểm').fill(f.scope.locationId);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
}
async function menu(page: Page, publicId: string) {
  await page.goto(`/t/${publicId}`);
  await expect(page.getByRole('button', { name: 'Thêm E2E rice vào giỏ nháp' })).toBeVisible();
}
async function cart(page: Page) {
  await page.getByRole('button', { name: 'Thêm E2E rice vào giỏ nháp' }).click();
  await page.getByRole('button', { name: /Giỏ nháp/ }).click();
}
async function activate(host: Page, manager: Page, f: Fixture) {
  await menu(host, f.tables[0]!.publicId);
  await cart(host);
  await host.getByRole('button', { name: 'Yêu cầu kích hoạt bàn', exact: true }).click();
  await manager.getByRole('checkbox', { name: /Tôi đã trực tiếp xác nhận/ }).check();
  await manager.getByRole('button', { name: 'Duyệt kích hoạt', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Tiếp tục với bàn đã kích hoạt' })).toBeVisible();
  expect(await f.prisma.order.count({ where: f.scope })).toBe(0);
  await host.getByRole('button', { name: 'Tiếp tục với bàn đã kích hoạt' }).click();
  await expect(host.getByText('Đã cấp quyền tại bàn', { exact: true })).toBeVisible();
  await expect(host.getByLabel('Số lượng hiện tại: 1')).toBeVisible();
  expect(await f.prisma.order.count({ where: f.scope })).toBe(0);
  return f.prisma.tableSession.findFirstOrThrow({
    where: { ...f.scope, tableId: f.tables[0]!.id },
  });
}
async function issueCode(host: Page) {
  await host.getByRole('button', { name: 'Tạo Join Code', exact: true }).click();
  const value =
    (await host.getByLabel('Join Code hiện tại', { exact: true }).textContent())?.trim() ?? '';
  if (!/^\d{6}$/.test(value)) throw new Error('Expected newly issued synthetic Join Code');
  return value;
}
async function join(page: Page, code: string) {
  await page.getByLabel('Join Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Tham gia bàn', exact: true }).click();
  await expect(page.getByText('Đã cấp quyền tại bàn', { exact: true })).toBeVisible();
}

test.describe('M2 complete local browser flow', () => {
  let f: Fixture;
  const contexts: BrowserContext[] = [];
  test.beforeEach(async () => {
    f = await createFixture();
  });
  test.afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()));
    if (f) await f.close();
  });

  test('Guest + member + Waiter consolidate one Bill; committed queue, retry and reconnect refetch', async ({
    browser,
  }) => {
    const manager = await open(browser, contexts),
      kitchen = await open(browser, contexts),
      host = await open(browser, contexts);
    await login(manager.page, f, 'manager');
    await login(kitchen.page, f, 'kitchen');
    const me = await manager.context.request.get('/api/v1/staff/auth/me');
    const permissions = ((await me.json()) as { data: { staff: { permissions: string[] } } }).data
      .staff.permissions;
    expect(permissions).toEqual(
      expect.arrayContaining(['bill.read', 'order.create_for_table', 'table.activation.approve']),
    );
    expect(new Set(permissions).size).toBe(permissions.length); // Real multi-role permission union.
    await expect.poll(() => kitchen.realtime.connections).toBeGreaterThan(0);
    await expect(
      kitchen.page.getByText('Chưa có món ở trạng thái này tại trạm đã chọn.'),
    ).toBeVisible();
    const dining = await activate(host.page, manager.page, f);
    await expect.poll(() => host.realtime.connections).toBeGreaterThan(1); // Browse activation then Bill subscription.

    const keys: string[] = [];
    let loseFirstResponse = true;
    await host.page.route('**/api/v1/orders', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      const response = await route.fetch(); // Let the real API commit before losing the response.
      if (loseFirstResponse) {
        loseFirstResponse = false;
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    await host.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
    await expect(
      host.page.getByText(/Kết nối bị gián đoạn\. Thử lại sẽ dùng cùng mã yêu cầu/),
    ).toBeVisible();
    await expect(kitchen.page.locator('.kitchen-items li')).toHaveCount(1);
    await expect.poll(() => kitchen.realtime.hints.includes('fulfillment.item.created')).toBe(true);
    await host.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
    await expect.poll(() => f.prisma.order.count({ where: f.scope })).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);

    const code = await issueCode(host.page);
    const member = await open(browser, contexts);
    await menu(member.page, f.tables[0]!.publicId);
    await cart(member.page);
    await join(member.page, code);
    await member.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
    await expect(host.page.locator('.bill-preview .bill-totals')).toContainText('84.000');
    await expect.poll(() => host.realtime.hints.includes('bill.updated')).toBe(true);

    host.realtime.drop = true; // Miss only notifications; REST stays live and no business data is mocked.
    await manager.page.getByRole('combobox', { name: /^Phiên bàn/ }).selectOption(dining.id);
    await manager.page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await manager.page.getByRole('button', { name: 'Gửi order', exact: true }).click();
    await expect(kitchen.page.locator('.kitchen-items li')).toHaveCount(3);
    await expect(host.page.locator('.bill-preview .bill-totals')).toContainText('84.000');
    const previousConnections = host.realtime.connections;
    host.realtime.drop = false;
    await host.realtime.socket!.close();
    await expect.poll(() => host.realtime.connections).toBeGreaterThan(previousConnections);
    await expect(host.page.locator('.bill-preview .bill-totals')).toContainText('126.000');
    const bill = await f.prisma.bill.findUniqueOrThrow({
      where: { tableSessionId: dining.id },
      include: { lines: true },
    });
    expect(bill.totalAmount).toBe(126_000n);
    expect(bill.lines).toHaveLength(3);
    expect(await f.prisma.order.count({ where: f.scope })).toBe(3);
    await expect
      .poll(() =>
        f.prisma.outboxEvent.count({ where: { ...f.scope, publishedAt: null, failedAt: null } }),
      )
      .toBe(0);
  });

  test('copied QR and replaced Join Code cannot order; unauthenticated and cross-table reads fail', async ({
    browser,
  }) => {
    const manager = await open(browser, contexts),
      host = await open(browser, contexts);
    await login(manager.page, f, 'manager');
    await activate(host.page, manager.page, f);
    const oldCode = await issueCode(host.page);
    host.page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    const replacement = host.page.waitForResponse(
      (response) =>
        response.url().endsWith('/table-sessions/current/join-code') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await host.page.getByRole('button', { name: 'Tạo Join Code mới', exact: true }).click();
    await replacement;
    const copied = await open(browser, contexts);
    await menu(copied.page, f.tables[0]!.publicId);
    await cart(copied.page);
    await expect(copied.page.getByRole('button', { name: 'Gửi món', exact: true })).toBeDisabled();
    const denied = await copied.context.request.get('/api/v1/staff/fulfillment/items');
    expect(denied.status()).toBe(401);
    await copied.page.getByLabel('Join Code', { exact: true }).fill(oldCode);
    await copied.page.getByRole('button', { name: 'Tham gia bàn', exact: true }).click();
    await expect(
      copied.page.getByText('Mã tham gia không đúng, đã hết hạn hoặc đã được thay thế.'),
    ).toBeVisible();
    await expect(copied.page.getByRole('button', { name: 'Gửi món', exact: true })).toBeDisabled();
    const another = await open(browser, contexts);
    await menu(another.page, f.tables[1]!.publicId);
    await expect
      .poll(() => f.prisma.guestSession.count({ where: { tableId: f.tables[1]!.id } }))
      .toBeGreaterThan(0);
    const bill = await another.context.request.get('/api/v1/table-sessions/current');
    expect(bill.status()).toBe(403);
    expect(await f.prisma.order.count({ where: f.scope })).toBe(0);
  });

  for (const failure of ['expired', 'revoked'] as const)
    test(`${failure} Guest recovers browse and rejoins explicitly without reload or draft loss`, async ({
      browser,
    }) => {
      const manager = await open(browser, contexts),
        host = await open(browser, contexts),
        member = await open(browser, contexts);
      await login(manager.page, f, 'manager');
      const dining = await activate(host.page, manager.page, f);
      const code = await issueCode(host.page);
      await menu(member.page, f.tables[0]!.publicId);
      await join(member.page, code);
      await cart(member.page);
      const activation = await f.prisma.activationRequest.findUniqueOrThrow({
        where: { id: dining.activationRequestId },
      });
      const joined = await f.prisma.guestSession.findFirstOrThrow({
        where: {
          ...f.scope,
          tableSessionId: dining.id,
          id: { not: activation.requesterGuestSessionId },
        },
      });
      // Fault only this run's member immediately before submission, avoiding an initial-refetch race.
      await member.page.route('**/api/v1/orders', async (route) => {
        if (failure === 'revoked')
          await f.prisma.guestSession.update({
            where: { id: joined.id },
            data: { revokedAt: new Date() },
          });
        else {
          const [clock] = await f.prisma.$queryRaw<
            Array<{ now: Date }>
          >`SELECT clock_timestamp() AS now`;
          await f.prisma.guestSession.update({
            where: { id: joined.id },
            data: {
              createdAt: new Date(clock!.now.getTime() - 120_000),
              lastSeenAt: new Date(clock!.now.getTime() - 60_000),
              idleExpiresAt: new Date(clock!.now.getTime() - 1000),
            },
          });
        }
        await route.continue();
      });
      await member.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
      await expect(
        member.page.getByText(
          'Phiên gọi món đã hết hạn. Giỏ nháp được giữ lại để bạn tham gia lại.',
        ),
      ).toBeVisible();
      await member.page.unroute('**/api/v1/orders');
      await member.page.getByRole('button', { name: 'Khôi phục phiên xem thực đơn' }).click();
      await expect(
        member.page.getByRole('button', { name: 'Gửi món', exact: true }),
      ).toBeDisabled();
      await join(member.page, code);
      await expect(member.page.getByLabel('Số lượng hiện tại: 1')).toBeVisible();
      expect(await f.prisma.order.count({ where: f.scope })).toBe(0);
      await member.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
      await expect.poll(() => f.prisma.order.count({ where: f.scope })).toBe(1);
    });

  test('Manager preserves SERVED history while applying the exceptional full waiver', async ({
    browser,
  }) => {
    const manager = await open(browser, contexts),
      host = await open(browser, contexts);
    await login(manager.page, f, 'manager');
    await activate(host.page, manager.page, f);
    await host.page.getByRole('button', { name: 'Gửi món', exact: true }).click();
    await expect(manager.page.getByRole('button', { name: 'Bắt đầu chuẩn bị' })).toBeVisible();
    await manager.page.getByRole('button', { name: 'Bắt đầu chuẩn bị' }).click();
    await manager.page.getByLabel('Trạng thái món').selectOption('PREPARING');
    await expect(manager.page.getByRole('button', { name: 'Đánh dấu sẵn sàng' })).toBeVisible();
    await manager.page.getByRole('button', { name: 'Đánh dấu sẵn sàng' }).click();
    await manager.page.getByLabel('Trạng thái món').selectOption('READY');
    await expect(manager.page.getByRole('button', { name: 'Đánh dấu đã phục vụ' })).toBeVisible();
    await manager.page.getByRole('button', { name: 'Đánh dấu đã phục vụ' }).click();
    await manager.page.getByLabel('Trạng thái món').selectOption('SERVED');
    await expect(
      manager.page.getByRole('button', {
        name: 'Miễn toàn bộ phí · giữ trạng thái đã phục vụ',
      }),
    ).toBeVisible();
    await manager.page
      .getByLabel('Lý do điều chỉnh ngoại lệ')
      .fill('E2E xác nhận phục vụ nhầm bàn');
    manager.page.once('dialog', (dialog) => void dialog.accept());
    await manager.page
      .getByRole('button', { name: 'Miễn toàn bộ phí · giữ trạng thái đã phục vụ' })
      .click();
    await expect(manager.page.getByText('Manager đã miễn toàn bộ phí')).toBeVisible();
    const item = await f.prisma.orderItem.findFirstOrThrow({
      where: { ...f.scope, order: { tableSession: { tableId: f.tables[0]!.id } } },
      include: { billAdjustments: true },
    });
    expect(item.status).toBe('SERVED');
    expect(item.servedAt).toBeInstanceOf(Date);
    expect(item.billAdjustments).toEqual([
      expect.objectContaining({ kind: 'FULL_MANAGER_WAIVER', amount: -42_000n }),
    ]);
  });
});
