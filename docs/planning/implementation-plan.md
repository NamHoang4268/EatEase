# Implementation plan and task tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

Planning completion và implementation completion là hai việc khác nhau. M1 foundation đã được implement và verified; M2 đang được triển khai theo task sequence, M3–M5 chưa được implement.

## M0 — Repository and documentation bootstrap

| Status | Task                                                       | Verification                                                                                            |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DONE   | Xác nhận repository boundary và V1 separation              | Absolute paths + clean V1 status                                                                        |
| DONE   | Initialize local Git, không remote/commit                  | `.git` exists; no remote/commit                                                                         |
| DONE   | Tạo root/docs/placeholder tree                             | Tree inventory                                                                                          |
| DONE   | Viết README, AGENTS và documentation index                 | Content review                                                                                          |
| DONE   | Ghi product requirements/business rules                    | Decision consistency review                                                                             |
| DONE   | Ghi architecture, security, API, permissions và ADRs       | Cross-link review                                                                                       |
| DONE   | Ghi roadmap, Phase 1 và decision log                       | Status/acceptance review                                                                                |
| DONE   | Verify all relative Markdown links and final Git/V1 status | 21 Markdown files; 0 missing links; V1 clean                                                            |
| DONE   | Final focused documentation audit trước initial commit     | Business/architecture/planning consistency reviewed; approval gates and decision classification aligned |

## M1 — Project foundation

Dependency: M0 complete và approved. Technical baseline: [ADR-0006](../architecture/adr/0006-m1-technical-foundation.md).

**Milestone status:** implementation, verification và owner approval `DONE`; M2 readiness review đã hoàn tất.

Mỗi assigned delivery bắt đầu từ updated `main`, giữ scope rõ và dừng tại review/authorization checkpoint. M1.2–M1.7 là planning workstreams: owner có thể giao từng workstream riêng hoặc gộp các workstream liền kề thành một cohesive foundation delivery. Branch được ghi dưới mỗi workstream là default khi thực hiện standalone; cohesive delivery dùng branch được owner chỉ định. Không yêu cầu approval giữa internal steps đã nằm trong assigned scope, nhưng vẫn phải verify và cập nhật status/evidence cho từng workstream. Không tự động commit, push, tạo/merge PR hoặc bắt đầu task chưa được giao.

### M1.1 — Record technical foundation decisions

- **Status:** `DONE`; đây là documentation decision task, không đồng nghĩa M1 implementation đã bắt đầu.
- **Branch:** `docs/m1-technical-foundation`.
- **Scope/artifacts:** ADR-0006, ADR index/refinement, decision log và M1 task plan.
- **Acceptance:** approved major/tool directions được ghi rõ; candidate pins vẫn conditional; existing business/security decisions không đổi.
- **Verification:** 23 Markdown files, 0 broken relative links, ADR numbering/status và decision classification hợp lệ; diff chỉ thuộc `docs/` trên đúng task branch.
- **Checkpoint:** dừng để owner review; commit, push và PR cần authorization riêng; không bắt đầu M1.2.

### M1.2 — Workspace foundation

- **Status:** `DONE`.
- **Branch:** `chore/workspace-foundation`.
- **Scope/artifacts:** root package manifest/scripts, `pnpm-workspace.yaml`, lockfile, Node/pnpm pins, strict TypeScript base và `packages/eslint-config`, `packages/tsconfig`.
- **Acceptance:** native pnpm workspace nhận đúng `apps/*`, `packages/*`; không Turbo/Nx hoặc premature shared package; Windows-compatible scripts.
- **Verification:** pnpm `12.15.0` install + lockfile, five workspace projects, strict shared configs, peer check không còn issue; exact Node `24.22.1` runtime được kiểm chứng.
- **Checkpoint:** review exact pins/peer compatibility và workspace diff trước commit/PR nếu standalone; nếu thuộc authorized cohesive delivery, có thể tiếp tục internal workstream kế tiếp sau khi verification đạt.

### M1.3 — API foundation

- **Status:** `DONE`.
- **Branch:** `chore/api-foundation`.
- **Scope/artifacts:** `apps/api` NestJS 12/Express ESM-first, validated API environment, health/readiness endpoints và foundation smoke test.
- **Acceptance:** API khởi động/build được trên approved Node line; ESM runtime đúng; chưa có business module hoặc auth policy mới.
- **Verification:** lint/typecheck pass, 3 tests pass, production build pass, live `/api/v1/health` và database-backed `/api/v1/health/ready` pass.
- **Checkpoint:** review NestJS/TypeScript/ESM compatibility evidence trước commit/PR nếu standalone; nếu thuộc authorized cohesive delivery, có thể tiếp tục internal workstream kế tiếp sau khi verification đạt.

### M1.4 — Web foundation

- **Status:** `DONE`.
- **Branch:** `chore/web-foundation`.
- **Scope/artifacts:** `apps/web` Next.js 16 App Router, validated public/server environment, minimal foundation page và API integration seam.
- **Acceptance:** development/production build chạy; React compatibility verified; không duplicate authoritative mutation hoặc thêm business feature.
- **Verification:** lint/typecheck pass, 3 tests pass, Next.js production build pass, `/`, `/health`, relative API rewrite và proxied DB readiness pass.
- **Checkpoint:** review Next.js/React versions và integration assumptions trước commit/PR; rewrite/cookie behavior chưa được finalized nếu chưa test.

### M1.5 — Database foundation

- **Status:** `DONE`.
- **Branch:** `chore/database-foundation`.
- **Scope/artifacts:** local PostgreSQL Docker Compose, Prisma 7 trong API boundary, reviewed migration workflow, database scripts và safe env example.
- **Acceptance:** clean database connectivity/migration workflow chạy được; không schema push cho managed environment, artificial business table hoặc premature domain migration.
- **Verification:** PostgreSQL `18.6-bookworm` healthy, Prisma `7.10.1` validation/generation pass, no-migration deploy path pass và Prisma connection smoke pass.
- **Checkpoint:** review Prisma/PostgreSQL compatibility, image/exact pin và migration evidence trước commit/PR.

### M1.6 — Quality and testing

- **Status:** `DONE`.
- **Branch:** `test/foundation-tooling`.
- **Scope/artifacts:** ESLint Flat Config, separate Prettier, Vitest baseline, relevant React Testing Library/Supertest integration và Playwright foundation smoke coverage khi apps sẵn sàng.
- **Acceptance:** tooling chỉ được thêm khi có actual target; real PostgreSQL được dùng cho database integration; không mock database invariants.
- **Verification:** format/lint/typecheck pass; API health success/failure, environment, web environment/component tests pass; PostgreSQL-backed readiness integration pass; production builds pass. Playwright chưa thêm vì chưa có browser workflow ngoài foundation page/proxy.
- **Checkpoint:** review tool/plugin peer compatibility và test evidence trước commit/PR.

### M1.7 — CI baseline

- **Status:** `DONE`.
- **Branch:** `ci/foundation-validation`.
- **Scope/artifacts:** GitHub Actions validation cho Pull Requests và `main`, frozen pnpm install, quality/build jobs, PostgreSQL-backed integration và E2E smoke jobs khi ready.
- **Acceptance:** clean checkout chạy lại được local-equivalent checks; CI không chứa secret hoặc silently skip failure.
- **Verification:** GitHub Actions workflow chạy trên Pull Requests và `main`; frozen install, format, lint, typecheck, unit/component tests, Prisma validate/deploy, real PostgreSQL integration và builds đều là required executable steps. Initial cloud deployment từ `main` và Render `checksPass` auto-deploy đã được verify.
- **Checkpoint:** hosted CI và automatic deployment đã được verify; M1 milestone gate sau đó đã được owner approve.

### M1.8 — Developer guide and M1 audit

- **Status:** `DONE` — local setup/audit, cloud deployment record và owner milestone approval đã hoàn tất.
- **Branch:** `docs/m1-developer-guide`.
- **Scope/artifacts:** Windows-compatible setup guide, prerequisites, scripts, environment/migration workflow, M1 verification record và planning status updates.
- **Acceptance:** fresh setup có thể follow tài liệu; mọi M1 acceptance criterion trong [roadmap](roadmap.md#m1--project-foundation) có evidence hoặc explicit unresolved blocker.
- **Verification:** local documentation links, Docker/Prisma integration và CI-equivalent command suite pass; Vercel web, Render API, Neon-backed readiness và same-origin API rewrite được verify ngày `2026-10-27`. Xem [deployment verification record](../development/deployment.md#m1-verification-record).
- **Checkpoint:** M1 milestone gate đã được owner approve; M2 implementation vẫn cần task-specific authorization.

## M2 — First business vertical slice

Dependency: M1 complete/owner-approved; [Phase 1 plan](phase-01.md) approved. M2 readiness review đã hoàn tất; các decision còn pending chỉ block task phụ thuộc trực tiếp, không block M2.1 catalog schema.

| Status | Sequence | Task                                                                             |
| ------ | -------- | -------------------------------------------------------------------------------- |
| DONE   | M2.0     | Clarify catalog/table baseline, approved constraints và remaining decision gates |
| DONE   | M2.1     | Implement scoped restaurant/location/table/menu schema + synthetic fixtures      |
| DONE   | M2.2     | Implement public static-QR table context, menu API và customer browse/cart       |
| TODO   | M2.3     | Implement staff auth, memberships, multi-role permissions và login               |
| TODO   | M2.4     | Implement browse-only guest session, cookie/origin boundary và CSRF              |
| TODO   | M2.5     | Implement activation request, generic waiting state và staff queue               |
| TODO   | M2.6     | Implement atomic approval/rejection và approved credential-claim contract        |
| TODO   | M2.7     | Implement join-code issue/rotate/rate-limit/recovery                             |
| TODO   | M2.8     | Implement ordering/billing/idempotency/outbox persistence                        |
| TODO   | M2.9     | Implement shared guest/Waiter `SubmitOrder` and consolidated bill preview        |
| TODO   | M2.10    | Implement read-only unified kitchen queue                                        |
| TODO   | M2.11    | Implement approved outbox publisher/realtime topology                            |
| TODO   | M2.12    | Complete unit/integration/authorization/concurrency/E2E evidence                 |

M2.1 evidence: versioned Prisma migration deploys cleanly on isolated PostgreSQL; integration tests cover scoped relationships, documented uniqueness/check constraints, MVP one-active-location partial index và idempotent synthetic fixtures. Public menu/API behavior remains M2.2 scope.

M2.2 evidence: read-only public table/menu endpoints enforce active scope and safe errors, serialize VND `BIGINT` without precision loss, and pass real PostgreSQL scope/ordering tests. `/t/[publicId]` provides responsive browse states and an in-memory draft cart with tested quantity/subtotal behavior; it creates no credential, activation request or order.

## M3 — Fulfillment, cancellation and serving

Dependency: M2.

| Status | Task                                                    |
| ------ | ------------------------------------------------------- |
| TODO   | Implement KITCHEN/BAR/DIRECT queue filters              |
| TODO   | Implement versioned item transitions                    |
| TODO   | Implement guest cancellation request and waiter routing |
| TODO   | Implement Kitchen PREPARING decision                    |
| TODO   | Implement automatic full-waiver adjustments             |
| TODO   | Implement Manager exceptional full correction           |
| TODO   | Implement waiter serving workflow                       |
| TODO   | Implement realtime/reconnect behavior and audit tests   |

## M4 — Checkout and table lifecycle

Dependency: M3.

| Status | Task                                                       |
| ------ | ---------------------------------------------------------- |
| TODO   | Implement checkout lock/resume                             |
| TODO   | Implement cashier bill view                                |
| TODO   | Implement idempotent cash payment + settlement transaction |
| TODO   | Implement session close                                    |
| TODO   | Implement cleaning and mark-ready                          |
| TODO   | Implement receipt/basic revenue records                    |
| TODO   | Complete financial concurrency and lifecycle E2E tests     |

## M5 — Production readiness and AWS

Dependency: stable M4.

| Status | Task                                          |
| ------ | --------------------------------------------- |
| TODO   | Production container strategy                 |
| TODO   | CI/CD quality, migration and deployment gates |
| TODO   | Terraform/AWS architecture and environments   |
| TODO   | Secrets, backups and restore validation       |
| TODO   | Logging, metrics, traces and alerts           |
| TODO   | Security/load/recovery validation             |
| TODO   | Runbooks, rollback and release evidence       |

## Update rules

- Chuyển task sang `IN_PROGRESS` khi bắt đầu thực tế.
- `BLOCKED` phải kèm blocker trong task/issue hoặc adjacent note.
- `DONE` yêu cầu verification evidence; documentation-only không hoàn tất implementation task.
- Scope/decision change phải cập nhật [decision log](decision-log.md) và ADR nếu cần.
