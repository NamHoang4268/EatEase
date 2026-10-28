# Decision log

Last baseline update: 2026-10-28.

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

### Design

- UI/UX dùng **Modern Editorial SaaS — Soft Yellow & Neutral** theo [authoritative design guideline](../design/ui-guidelines.md); customer mobile-first editorial, management Modern SaaS và POS/kitchen operational clarity. Bento là preferred composition khi cải thiện hierarchy, không phải mandatory page layout.

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
- Initial M1 cloud deployment verified ngày `2026-10-27`: Vercel web, Render Singapore API, Neon Singapore database và same-origin API rewrite. Operational URLs/evidence nằm trong [deployment guide](../development/deployment.md#current-m1-deployment); đây không phải production domain decision.
- Trong MVP, mỗi restaurant có tối đa một active location; PostgreSQL enforce bằng partial unique index trên `location(restaurant_id)` khi `is_active = true`. Đây là MVP-only constraint; multi-location tương lai cần explicit approval và reviewed migration để thay thế hoặc loại bỏ index, không thay đổi scoped schema foundation.
- Public portfolio deployment được phép dùng deterministic, synthetic restaurant/location/table/menu fixtures. Fixtures không được chứa real credential, secret, personal information hoặc dữ liệu người thật và chỉ được load bằng explicit operation.
- Staff authentication dùng opaque CSPRNG server-side session, chỉ persist SHA-256 token hash, bind một active membership/location, absolute expiry 8 giờ không rolling refresh và immediate database revocation khi logout.
- Staff CSRF dùng per-session synchronizer token hash. Login trả raw token một lần; authenticated mutation cần `X-CSRF-Token` + trusted Origin. Authenticated recovery endpoint rotate replacement token và không tạo session mới.
- Staff password dùng Node.js `scrypt` với random salt. Login abuse protection cho phép tối đa 5 failures/15 phút theo normalized email + source IP bằng in-memory limiter cho MVP single instance; không persistent lockout.
- Portfolio cross-site staff auth dùng explicit credentialed CORS allowlist và host-only production cookie `HttpOnly; Secure; SameSite=None`; local HTTP dùng `SameSite=Lax` không `Secure`. Browser third-party-cookie restrictions vẫn là deployment limitation.
- Guest browse session (M2.4) dùng opaque CSPRNG token, chỉ persist SHA-256 hash trong database, bind một active table/location/restaurant context với access level `BROWSE_ONLY`. Safe reuse/refresh trên cùng một bàn ngăn chặn việc tạo session tràn lan khi tải lại trang; không cấp quyền ordering hay kích hoạt bàn.
- Guest session timeouts: idle timeout 30 phút (gia hạn khi có hoạt động hợp lệ trên cùng bàn) và absolute timeout 8 giờ (không thể kéo dài), cấu hình qua `GUEST_IDLE_TIMEOUT_MINUTES` và `GUEST_ABSOLUTE_TIMEOUT_HOURS`.
- Guest CSRF dùng per-session synchronizer token hash: bootstrap cấp raw token trong response `Cache-Control: no-store`, database chỉ lưu SHA-256 hash, authenticated requests yêu cầu trusted Origin và `X-CSRF-Token`. Endpoint `GET /guest-sessions/csrf-token` rotate token sau browser refresh.
- Guest cookie `eatease_guest_session` tách biệt hoàn toàn với staff cookie, host-only `HttpOnly`, `SameSite=Lax` trong local dev và `SameSite=None; Secure` trong cross-site production.
- Defer `TableSession` physical relation: `guest_session.table_session_id` là nullable column và chưa tạo FK vật lý ở M2.4 để tránh tạo placeholder table sớm.
- Activation request TTL mặc định 5 phút và configurable qua `ACTIVATION_REQUEST_TTL_MINUTES`.
- `GET /activation-requests/current` là strictly read-only: không business-state mutation, cookie rotation, session renewal, credential upgrade hoặc join-code issuance. Effective expiry được project khi đọc; expiry persistence chỉ diễn ra trên write side.
- M2.5 dùng minimal generic idempotency persistence cho `REQUEST_ACTIVATION`; cùng actor/operation/key với payload fingerprint khác phải bị reject.
- M2.6 staff approval requires valid staff session, `table.activation.approve`, matching membership location scope, optimistic `expectedVersion` và explicit `physicalPresenceConfirmed: true`; không yêu cầu GPS hoặc dynamic QR.
- Approval atomically transitions request `PENDING → APPROVED`, creates exactly one linked `ACTIVE` TableSession and zero-value `OPEN` Bill, changes table `AVAILABLE → OCCUPIED`, and writes idempotency, audit and minimal outbox records. Rejection atomically transitions `PENDING → REJECTED` with audit/outbox but creates no session/bill and does not occupy the table.
- Approval không upgrade guest credential. Original requester must explicitly invoke `POST /activation-requests/current/claim`; other devices remain unauthorized and join codes remain M2.7.
- Claim atomically binds the requester GuestSession to the approved TableSession, changes `BROWSE_ONLY → ORDER_ENABLED`, rotates guest + CSRF credentials and writes audit/idempotency. Previous credential recovery is restricted to this claim endpoint for 120 seconds, requires previous CSRF + same idempotency operation/key, never extends the original deadline, and persists hashes only.
- M2.6 persists `activation.updated`/`table.session.updated` transactional outbox records but does not add publisher, worker or realtime delivery. Approve, reject and claim each create atomic audit records; no raw credential/CSRF data is stored.
- M2.6 includes minimal staff login/session UI, location-scoped activation queue, approval attestation/rejection actions and an explicit guest “Continue with activated table” claim action. Ordering, cart submission, kitchen processing, BillLines and settlement remain out of scope.

## PROPOSED

- Join-code TTL: 30 phút.
- Same-origin deployment direction (web/API/Socket.IO sau một public origin), dùng host-only `HttpOnly; Secure; SameSite=Lax` cookies.
- Outbox publisher chạy cùng API process trong MVP với safe locking.
  Các proposal phải được validated/chốt ở milestone implementation liên quan, không được hardcode ngầm.

## OPEN

- Production domain và exact reverse-proxy topology.
- Local Next.js REST rewrite, browser/API cookie-session boundary và Socket.IO proxy/WebSocket upgrade behavior.
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
