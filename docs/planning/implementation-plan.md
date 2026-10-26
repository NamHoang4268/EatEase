# Implementation plan and task tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

Planning completion và implementation completion là hai việc khác nhau. M1–M5 hiện chưa được implement.

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

- **Status:** `IN_PROGRESS` — workflow và local-equivalent validation hoàn tất; GitHub-hosted PR run cần owner push/PR để verify.
- **Branch:** `ci/foundation-validation`.
- **Scope/artifacts:** GitHub Actions validation cho Pull Requests và `main`, frozen pnpm install, quality/build jobs, PostgreSQL-backed integration và E2E smoke jobs khi ready.
- **Acceptance:** clean checkout chạy lại được local-equivalent checks; CI không chứa secret hoặc silently skip failure.
- **Verification:** workflow review/local commands pass cho frozen install, format, lint, typecheck, unit/component tests, Prisma validate/deploy, real PostgreSQL integration và builds; hosted run chưa có evidence.
- **Checkpoint:** owner review workflow permissions/cost/evidence trước merge; CI approval không tự động hoàn tất M1.

### M1.8 — Developer guide and M1 audit

- **Status:** `IN_PROGRESS` — local audit/setup/deployment guide hoàn tất; chờ hosted CI, public endpoint verification và owner milestone approval.
- **Branch:** `docs/m1-developer-guide`.
- **Scope/artifacts:** Windows-compatible setup guide, prerequisites, scripts, environment/migration workflow, M1 verification record và planning status updates.
- **Acceptance:** fresh setup có thể follow tài liệu; mọi M1 acceptance criterion trong [roadmap](roadmap.md#m1--project-foundation) có evidence hoặc explicit unresolved blocker.
- **Verification:** local documentation links, Docker/Prisma integration và CI-equivalent command suite pass; Vercel/Render/Neon dashboard setup/public endpoints chưa được thực hiện vì cần owner accounts/secrets.
- **Checkpoint:** dừng tại M1 milestone approval gate; không bắt đầu M2 nếu chưa có explicit owner approval.

## M2 — First business vertical slice

Dependency: M1 complete; [Phase 1 plan](phase-01.md) approved.

| Status | Task                                                                 |
| ------ | -------------------------------------------------------------------- |
| TODO   | Implement restaurant/location/table/menu minimum model + fixtures    |
| TODO   | Implement staff auth, memberships, multi-role permissions            |
| TODO   | Implement static QR public table/menu context                        |
| TODO   | Implement browse-only guest session + CSRF                           |
| TODO   | Implement activation request/waiting UX and concurrent guard         |
| TODO   | Implement waiter approval transaction                                |
| TODO   | Implement join-code issue/rotate/rate-limit/recovery                 |
| TODO   | Implement explicit guest SubmitOrder                                 |
| TODO   | Implement waiter-assisted SubmitOrder using same use case            |
| TODO   | Implement consolidated bill preview                                  |
| TODO   | Implement unified kitchen queue read                                 |
| TODO   | Implement idempotency/outbox publisher and authorized realtime rooms |
| TODO   | Complete unit/integration/authorization/concurrency/E2E suite        |

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
