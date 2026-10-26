# ADR-0006: M1 technical foundation

- Status: **ACCEPTED**
- Date: 2026-10-26
- Refines: [ADR-0002](0002-typescript-web-api-stack.md), [ADR-0003](0003-postgresql-prisma.md), [ADR-0005](0005-monorepo.md)

## Context

M0 đã chốt TypeScript monorepo, Next.js App Router, NestJS/Express, PostgreSQL và Prisma. Trước khi scaffold M1, repository cần một toolchain đủ cụ thể để cài đặt lặp lại trên Windows và CI nhưng không biến việc tồn tại của từng release riêng lẻ thành bằng chứng rằng toàn bộ dependency matrix tương thích.

M1 chỉ xây project foundation. Business modules, domain schema và application workflows bắt đầu ở milestones sau.

## Decision

### Runtime and framework lines

Các major/version line sau được phê duyệt:

| Component | Approved line | Candidate pin |
|---|---|---|
| Node.js | 24 LTS | `24.22.1` |
| pnpm | 12 | `12.15.0` |
| TypeScript | 6 | `6.0.3` |
| Next.js | 16 App Router | `16.4.3` |
| NestJS | 12 với Express adapter | `12.2.0` |
| PostgreSQL | 18 | `postgres:18.6-bookworm` cho local |
| Prisma ORM | 7 stable | Chốt exact patch khi setup |

Candidate pins chỉ được ghi vào project sau khi task setup tương ứng xác minh availability, peer dependencies, build và runtime compatibility. Không dùng forced install, bỏ qua peer conflict hoặc coi toàn bộ matrix đã verified chỉ vì từng release tồn tại riêng lẻ.

API dùng ESM-first architecture. Next.js và React phải dùng một combination được framework hỗ trợ; không nâng React độc lập mà không kiểm tra compatibility.

### Workspace and boundaries

- Dùng native pnpm workspaces; không thêm Turborepo hoặc Nx trong M1.
- Applications ban đầu là `apps/web` và `apps/api`.
- Shared packages ban đầu chỉ là `packages/eslint-config` và `packages/tsconfig`.
- Prisma schema, generated client và persistence implementation ở trong API boundary.
- Không tạo sớm `common`, `contracts`, `database` hoặc `testing` package nếu chưa có demonstrated need.
- Web không import API internals hoặc Prisma; API không import web; config packages không chứa runtime business logic.

### Local development and migrations

- PostgreSQL chạy bằng Docker Compose; web và API chạy trực tiếp trên developer machine ban đầu.
- Scripts phải chạy trên Windows mà không phụ thuộc Bash-specific syntax.
- Managed environments chỉ áp dụng committed, reviewed Prisma migrations; không dùng schema push làm migration strategy.
- Custom SQL được phép theo [ADR-0003](0003-postgresql-prisma.md) khi Prisma schema không biểu đạt đủ database invariant.
- Không tạo artificial business table chỉ để chứng minh database setup trong M1.

### Configuration and quality

- Dùng ESLint Flat Config và chạy Prettier riêng; lint và formatting là hai validation độc lập.
- Mỗi application validate environment bằng Zod và fail fast khi configuration không hợp lệ.
- Browser chỉ nhận explicit public variables; API secrets không đi qua shared/browser package.
- TypeScript dùng strict baseline; config cụ thể cho Node/Nest và Next/browser được tách từ shared base phù hợp.

### Testing and CI direction

- Vitest cho unit testing.
- React Testing Library cho React component tests khi phù hợp.
- Supertest cho NestJS HTTP integration tests.
- PostgreSQL thật cho database integration, transaction và invariant tests.
- Playwright cho browser E2E tests.
- Testing infrastructure được thêm incrementally theo task thực tế; approval của tool không yêu cầu cấu hình tất cả trong task đầu tiên.
- GitHub Actions validate Pull Requests và `main` bằng frozen lockfile install, format, lint, typecheck, tests và build.
- PostgreSQL-backed integration tests và foundation E2E smoke tests được thêm khi foundation tương ứng sẵn sàng.

### Web/API integration boundary

NestJS REST API tiếp tục là authoritative. Next.js không duplicate authoritative business mutations. Browser API calls ưu tiên relative URLs và deployment đi theo same-origin direction.

Các chi tiết sau chưa finalized và phải được validate trước khi chuyển trạng thái: local Next.js REST rewrites, cookie/session behavior qua browser/API boundary, CSRF implementation, Socket.IO proxy/WebSocket upgrade và production reverse-proxy/domain topology.

## Compatibility verification requirements

Mỗi setup task phải:

1. Xác minh exact package/image còn available từ source chính thức.
2. Cài bằng lockfile không có forced peer override.
3. Chạy lint, typecheck, tests/build hoặc runtime smoke check phù hợp.
4. Ghi lại conflict và dừng xin approval nếu giải pháp đòi đổi approved major hoặc bỏ qua compatibility guard.

Các điểm cần chú ý gồm NestJS 12 + TypeScript 6, NestJS ESM runtime, Next.js + React, Prisma 7 + PostgreSQL 18 và Vitest/ESLint/TypeScript plugins.

## Consequences

- Toolchain đủ rõ để M1 triển khai lặp lại trên Windows và CI.
- Native workspaces giữ operational cost thấp cho solo project.
- ESM-first tránh migration module system sớm nhưng đòi dependency/test tooling tương thích.
- Package boundaries giảm accidental coupling; shared package bổ sung chỉ được tạo khi một task thực tế chứng minh nhu cầu.
- Exact pins có thể phải đổi trong cùng approved major nếu compatibility verification thất bại; thay đổi major cần approval mới.

## Alternatives considered

- npm/Yarn/Bun: không chọn cho M1 vì pnpm workspaces đáp ứng nhu cầu với single lockfile và filtering rõ.
- Turborepo/Nx: defer vì chưa có build-scale evidence biện minh task graph/cache layer bổ sung.
- Common/database/testing packages từ đầu: không chọn vì dễ trở thành dumping ground hoặc phá API persistence boundary.
- Mock/SQLite database integration: không chọn vì không verify PostgreSQL constraints, transactions và concurrency.
- Chạy toàn bộ stack trong containers: chưa cần cho local feedback loop ban đầu.

## Explicitly open or deferred

- Exact candidate pins và complete peer dependency matrix cho tới setup task liên quan.
- Staff authentication/session representation.
- Activation/join-code TTL và guest absolute timeout proposals.
- Exact cookie, CSRF, REST rewrite và Socket.IO proxy behavior.
- Outbox publisher execution model và retention policies.
- Production reverse proxy, domain và AWS topology.
