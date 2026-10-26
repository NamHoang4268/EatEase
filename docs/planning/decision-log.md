# Decision log

Last baseline update: 2026-10-27.

## APPROVED

### Product and workflow

- Official name là **EatEase**; “V2” không phải product name.
- New codebase, legacy repository read-only reference.
- Hybrid QR + waiter ordering trong cùng TableSession/Bill workflow.
- Customer-initiated, staff-confirmed activation một lần mỗi dining session.
- Approval không auto-submit; customer explicit Submit.
- Mỗi device có guest credential riêng; additional guest dùng temporary join code.
- Một TableSession, nhiều immutable Orders, một consolidated Bill.
- Item-level `KITCHEN`, `BAR`, `DIRECT`; unified board đầu tiên.
- `NEW` waiter cancellation và Kitchen-approved `PREPARING` cancellation nhận automatic full waiver.
- `READY/SERVED` exceptional correction cần Manager; no partial waiver MVP.
- Cash/cashier payment first; online payment deferred.
- Settlement, session close và physical table availability tách biệt.
- VND integer; displayed server-side price authoritative; tax/service charge = 0 MVP.
- One restaurant/one active location initially, scoped schema from beginning.

### Technical

- TypeScript monorepo.
- Next.js App Router; NestJS với Express adapter.
- PostgreSQL + Prisma; custom SQL migration khi cần.
- Modular Monolith.
- REST authoritative + Socket.IO notifications + transactional outbox.
- Database constraints, transactions, idempotency, permission/resource scoping.
- Guest idle timeout 30 phút là initial configurable security default với explicit recovery.
- M1 technical foundation theo [ADR-0006](../architecture/adr/0006-m1-technical-foundation.md): Node.js 24 LTS, pnpm 12 workspaces, TypeScript 6, Next.js 16 App Router, NestJS 12/Express ESM-first, PostgreSQL 18 và Prisma ORM 7 stable.
- M1 dùng native pnpm workspaces, không Turborepo/Nx; applications là `apps/web`, `apps/api`; initial shared packages chỉ gồm `packages/eslint-config`, `packages/tsconfig`.
- PostgreSQL local qua Docker Compose; web/API chạy trực tiếp trên developer machine; scripts không phụ thuộc Bash; managed migrations phải committed/reviewed và không dùng schema push.
- ESLint Flat Config + separate Prettier; per-application Zod environment validation.
- Testing direction: Vitest, React Testing Library, Supertest, PostgreSQL thật và Playwright; thêm incrementally theo nhu cầu task.
- GitHub Actions validate PR/`main` bằng frozen install, format, lint, typecheck, tests và build; database/E2E checks thêm khi foundation sẵn sàng.
- Exact M1 pins đã verify: Node.js `24.22.1`, pnpm `12.15.0`, TypeScript `6.0.3`, Next.js `16.4.3`, NestJS `12.2.0`, PostgreSQL `18.6-bookworm` và Prisma `7.10.1`.
- Portfolio/demo deployment theo [ADR-0007](../architecture/adr/0007-portfolio-deployment.md): Vercel Hobby web, Render Free API và Neon Free PostgreSQL; không thay thế AWS/M5 production direction.

## PROPOSED

- Activation request TTL: 5 phút.
- Join-code TTL: 30 phút.
- Guest absolute timeout: 8 giờ.
- One active location partial unique index trong MVP.
- Same-origin deployment direction (web/API/Socket.IO sau một public origin), dùng host-only `HttpOnly; Secure; SameSite=Lax` cookies.
- CSRF: allowed-Origin validation + synchronizer/signed double-submit token.
- Outbox publisher chạy cùng API process trong MVP với safe locking.
  Các proposal phải được validated/chốt ở milestone implementation liên quan, không được hardcode ngầm.

## OPEN

- Production domain và exact reverse-proxy topology.
- Staff session representation: opaque server-side session hay access/refresh pair.
- Local Next.js REST rewrite, browser/API cookie-session boundary và Socket.IO proxy/WebSocket upgrade behavior.
- Public Vercel/Render/Neon URLs và deployment verification evidence.
- Menu modifiers chi tiết ngoài contract tối thiểu.
- Manager force-close/correction procedure chi tiết.
- Retention/cleanup periods cho idempotency, outbox, audit và closed guest sessions.
- Exact AWS topology/capacity/DR targets cho M5.

## DEFERRED

- Split bills, partial payments và automated refunds.
- Online payment provider integration.
- Booking, pre-order và deposits.
- Loyalty, vouchers, AI assistant và social login.
- Advanced reports/custom IAM editor.
- Microservices, Kafka và Kubernetes trừ khi tương lai có concrete evidence.

## Change process

- Business decision từ `APPROVED` chỉ thay đổi sau explicit approval.
- Chuyển `PROPOSED/OPEN` sang `APPROVED` phải ghi ngày, rationale và ADR nếu là architectural decision.
- Không xóa historical decision; ghi superseding entry/ADR.
