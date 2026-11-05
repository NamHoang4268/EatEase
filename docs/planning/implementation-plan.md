# Implementation plan and task tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

Planning completion và implementation completion là hai việc khác nhau. M1/M2 và M3.1 đã hoàn tất, được owner verify; phần còn lại của M3 đang `IN_PROGRESS`, M4–M5 chưa bắt đầu.

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

**Status:** `DONE` — approved M2 acceptance criteria satisfied; owner final local validation `325/325` PASS. Production migration/deployment/public smoke remain pending separately; see [M2 final evidence](../development/m2-verification.md).

Dependency: M1 complete/owner-approved; [Phase 1 plan](phase-01.md) approved. M2 readiness review đã hoàn tất; các decision còn pending chỉ block task phụ thuộc trực tiếp, không block M2.1 catalog schema.

| Status | Sequence | Task                                                                             |
| ------ | -------- | -------------------------------------------------------------------------------- |
| DONE   | M2.0     | Clarify catalog/table baseline, approved constraints và remaining decision gates |
| DONE   | M2.1     | Implement scoped restaurant/location/table/menu schema + synthetic fixtures      |
| DONE   | M2.2     | Implement public static-QR table context, menu API và customer browse/cart       |
| DONE   | M2.3     | Implement staff auth, memberships, multi-role permissions và login               |
| DONE   | M2.4     | Implement browse-only guest session, cookie/origin boundary và CSRF              |
| DONE   | M2.5     | Implement activation request, generic waiting state và staff queue               |
| DONE   | M2.6     | Implement atomic approval/rejection và approved credential-claim contract        |
| DONE   | M2.7     | Implement secure Host/member join-code lifecycle, staff controls and recovery    |
| DONE   | M2.8     | Implement ordering/billing/idempotency/outbox persistence                        |
| DONE   | M2.9     | Implement shared guest/Waiter `SubmitOrder` and consolidated bill preview        |
| DONE   | M2.10    | Implement read-only unified kitchen queue                                        |
| DONE   | M2.11    | Implement approved outbox publisher/realtime topology                            |
| DONE   | M2.12    | Complete unit/integration/authorization/concurrency/E2E evidence                 |

M2.1 evidence: versioned Prisma migration deploys cleanly on isolated PostgreSQL; integration tests cover scoped relationships, documented uniqueness/check constraints, MVP one-active-location partial index và idempotent synthetic fixtures. Public menu/API behavior remains M2.2 scope.

M2.2 evidence: read-only public table/menu endpoints enforce active scope and safe errors, serialize VND `BIGINT` without precision loss, and pass real PostgreSQL scope/ordering tests. `/t/[publicId]` provides responsive browse states and an in-memory draft cart with tested quantity/subtotal behavior; it creates no credential, activation request or order.

M2.3 evidence: versioned staff/RBAC/session migration deploys cleanly on isolated PostgreSQL; opaque hash-only 8-hour sessions, salted `scrypt`, revocation, CSRF rotation/origin enforcement, explicit CORS/cookie policy and in-memory login throttling are covered by unit/integration tests. Authorization guard tests cover allowed, denied và wrong-location access; inactive/expired/revoked session paths use current database state. Local owner bootstrap is explicit and refuses managed database targets.

M2.4 evidence: versioned `guest_session` migration deploys cleanly on isolated PostgreSQL; opaque hash-only tokens, 30-minute idle and 8-hour absolute timeouts, synchronizer CSRF tokens, origin enforcement, safe session reuse on the same table, device/table isolation and separation between staff and guest cookies are covered by unit and PostgreSQL integration tests. Web client `/t/[publicId]` seamlessly integrates non-blocking guest bootstrap while preserving independent public menu and draft-cart functionality. TableSession foreign key is intentionally deferred to avoid premature placeholder tables.

M2.5 evidence: Prisma schema validates/client generates; API and customer UI implement guest request/current polling, generic other-device waiting, 5-minute configurable TTL, minimal idempotency and location-scoped staff queue. Component tests cover explicit activation, CSRF recovery with stable idempotency key và draft-cart preservation. Migration deploy và 5 PostgreSQL integration tests pass trên isolated local `eatease_m2_test`, bao phủ concurrent requests, partial unique enforcement, idempotency/payload conflict, read-only expiry projection + write-side transition, other-device privacy và staff session/permission/location isolation.

### M2.6 — Staff activation approval

**Status:** `DONE`; database, API, staff/guest UI và verification đã hoàn tất.

- [x] Add reviewed schema/migration for linked TableSession, one-to-one OPEN Bill, guest claim recovery hashes, scoped outbox and audit records.
- [x] Implement staff approve/reject commands with session + CSRF, `table.activation.approve`, location/resource isolation, `expectedVersion`, physical-presence attestation and command idempotency.
- [x] Enforce deterministic lock order, partial unique active-session guard, atomic request/session/bill/table/reliability writes, and race-safe `409` behavior.
- [x] Implement requester-only explicit claim with guest + CSRF rotation, fixed 120-second previous-token recovery window and no credential material in persistence/logging.
- [x] Add minimal `/staff/login` UI and location-scoped activation queue. Queue shows table code/capacity, request age/expiry/status/version; approval requires an explicit physical-presence checkbox, rejection requires a reason, actions keep one stable idempotency key and stale conflicts trigger refetch.
- [x] Add requester UI action **“Continue with activated table”**. Do not auto-claim while polling; preserve local draft cart, retain one request-scoped claim idempotency key in `sessionStorage` only for bounded recovery, avoid parallel claim calls, and never auto-submit cart.
- [x] Add unit, PostgreSQL integration, authorization/concurrency and UI tests for approval/rejection/claim, duplicate replay, stale versions, expiry, approve-vs-reject races, wrong location, other-device denial, token recovery before/after TTL, outbox/audit atomicity and absence of Order/BillLine/join-code side effects.
- [x] Update implementation evidence only after schema/API/UI checks and isolated PostgreSQL tests actually pass; do not mark M2.6 `DONE` from contract documentation alone.

M2.6 evidence: reviewed forward-only migrations enforce scoped TableSession/Bill/guest-session invariants; approve/reject/claim commands use deterministic locks, version checks, idempotency, atomic audit/outbox persistence and requester-only credential rotation. `/staff/login` restores staff sessions, exposes only the authorized location queue and requires physical-presence confirmation/rejection reason. `/t/[publicId]` renders activation terminal states and performs claim only after explicit guest action, preserving the draft cart and a bounded request-scoped recovery key without persisting credentials. Final verification on isolated PostgreSQL `eatease_m2_test`: 25 web component tests, 36 API unit tests and 51 API integration tests pass, cùng lint, typecheck, format, production builds và diff checks.

### M2.7 — Secure Join Code lifecycle

**Status:** `DONE`; database, Host/member/staff API, guest/staff UI, local verification và scoped production verification đã hoàn tất. IPv6 canonicalization remains a non-blocking security-hardening follow-up.

- [x] Persist HMAC-hashed six-digit Join Codes with 30-minute TTL, explicit Host/staff issue/replace/revoke, scoped relationships and one-current-code enforcement.
- [x] Derive Host eligibility from the original activation requester and successful claim; expose no administrative Host role or plaintext code after the one-time response.
- [x] Join additional devices with independent credentials, atomic rotation and fixed 120-second previous-credential recovery bound to the same operation and idempotency key.
- [x] Enforce PostgreSQL-backed failed-attempt limits: 5/10 minutes per browse guest+table, 20/10 minutes per source IP+table and aggregate 100/10 minutes per TableSession, each with fixed 10-minute cooldown.
- [x] Add location-scoped staff controls and mobile guest UI while preserving in-memory draft carts and requiring explicit confirmation before replacing a code.
- [x] Verify schema/migration, API/unit/component/integration behavior, concurrency, idempotency, recovery, authorization, secret handling and no ordering/billing side effects.

M2.7 evidence: reviewed forward-only migration adds scoped Join Code/rate-limit persistence and database constraints; API uses deterministic TableSession → JoinCode → GuestSession → sorted rate-bucket locking, HMAC-SHA-256 fingerprints and operation-scoped idempotency. Host/staff UI never persists plaintext and reload never auto-rotates. Security-review remediation fixes retry-key handling, fixed contract TTLs and signed Vercel → Render source-IP proof. Post-fix local verification: 47 API unit/request tests, 34 web unit/component tests and 8 focused PostgreSQL M2.7 integration tests pass on isolated `eatease_m2_test`, together with formatting, lint, typecheck and production builds. Additional spoof-resistance regressions pass `31/31` API and `14/14` Web tests plus both typechecks. Owner-observed production evidence confirms activation/claim/join, direct unsigned rejection, rotation, revocation, natural expiration, preservation of existing Guest access, Staff Session restoration and distinct Wi-Fi/4G IP buckets. Production threshold load testing was intentionally omitted; [the detailed record](../development/m2-7-production-verification.md) documents evidence boundaries, IPv6 canonicalization follow-up and demo cleanup guidance.

Out of scope for M2.7: order/cart submission and billing lines (M2.8–M2.9), kitchen workflows, outbox worker/realtime delivery (M2.11), settlement and later milestones.

### M2.8 — Ordering persistence

**Status:** `DONE` — implementation, isolated PostgreSQL verification, final owner validation and merge completed before M2.9 authorization.

- Owner approved `OrderStatus.SUBMITTED` only; Order is immutable and fulfillment stays item-level.
- Additive migration adds scoped Order/OrderItem/BillLine relationships, exact VND arithmetic, immutable submission guards and deferred graph/Bill consistency checks.
- Internal `OrderPersistence` reuses generic idempotency/outbox tables and implements atomic financial writes, stable replay, payload conflict and concurrent duplicate protection. No SubmitOrder endpoint/UI, Bill preview or outbox publisher is wired.
- Focused tests cover money precision/overflow and real PostgreSQL scope, snapshots, Bill consolidation, idempotency, concurrency, rollback, immutability and outbox persistence.
- Owner completed the required isolated PostgreSQL and final validation handoff, then merged M2.8 and synchronized `main` before authorizing M2.9.
- Validate only against explicitly verified isolated local `eatease_m2_test` or ephemeral localhost CI. Prisma CLI imports dotenv: point `DOTENV_CONFIG_PATH` at a nonexistent path and explicitly pin both database URLs; never use a real environment file or managed database for this validation.
- Integration fixtures use random IDs and retain submitted synthetic financial history in the isolated test DB, preserving append-only triggers. No reset, history deletion or disabling constraints is required for reruns.
- HTTP authentication/permission/Origin/CSRF orchestration and current consolidated Bill reads are delivered by M2.9; M2.8 remains the single persistence boundary.

### M2.9 — Shared SubmitOrder and consolidated Bill preview

**Status:** `DONE` — implementation and owner-executed focused/final validation completed on `2026-11-05`.

- One `OrderingService` maps authenticated Guest and Waiter requests to the M2.8 `OrderPersistence`; no second financial write path is introduced.
- Guest `POST /orders` requires order-enabled session binding plus Origin/CSRF/idempotency. Staff `POST /staff/table-sessions/{sessionId}/orders` additionally requires `order.create_for_table`, authenticated location scope and transactional StaffSession/permission revalidation.
- `GET /table-sessions/current` and `GET /staff/table-sessions/{sessionId}/bill` return fresh authoritative consolidated Bill totals and immutable historical snapshots as decimal strings.
- Customer UI explicitly submits, retains the draft and stable key on uncertain failures, and clears submitted entries only after confirmed success. Minimal Staff UI selects an active scoped table, uses the same command and displays its Bill preview.
- Focused unit/component tests cover contract validation, shared mapping, server-derived scope, snapshot serialization, stable retry keys and draft preservation. PostgreSQL coverage verifies route security, Guest/Waiter consolidation, replay/conflict/concurrency, wrong scope and transactional Staff authorization.
- No schema/migration, kitchen state transition, payment/settlement or outbox publisher is added. Do not start M2.10 automatically.

M2.9 verification: owner-executed final validation passed `99/99` API unit tests, `53/53` Web component tests and `83/83` PostgreSQL integration tests (`235/235` total). API/Web lint, typecheck, production builds, Prettier and `git diff --check` also passed. No M2.9 schema migration was required.

### M2.10 — Read-only unified kitchen queue

**Status:** `DONE` — implementation and owner-executed final validation complete.

- `GET /staff/fulfillment/items` reuses StaffSession and `fulfillment.read` guards, derives restaurant/location from the authenticated principal and returns NEW item snapshots from Guest and Waiter Orders.
- Optional immutable station filter, oldest-first `(submittedAt, itemId)` keyset pagination, default 50/max 100 items, safe operational fields and `Cache-Control: no-store`. No queue table, migration, business writes, polling or realtime publisher.
- Staff workspace includes a permission-gated kitchen view with manual refresh, station selection, next page and loading/empty/error/session-expired states. Kitchen-only staff do not fetch activation data.
- Focused tests cover validation, scoped bounded queries, Guest/Waiter inclusion, snapshots, pagination/ties, current staff permission/membership/session changes, uncommitted/rolled-back item exclusion and PostgreSQL READ ONLY execution. Integration fixtures use random IDs and retain append-only financial history in isolated local `eatease_m2_test`.
- `AGENTS.md` now requires `pnpm format:check` and `git diff --check` after every final edit, including status/evidence updates; fix affected files and rerun both before handoff.
- Final validation: owner executed `112/112` API unit tests, `61/61` Web component tests and `91/91` PostgreSQL integration tests (`264/264` total); all PASS. API and Web production builds PASS; API/Web lint and typecheck were also verified PASS.

### M2.11 — Outbox publisher and realtime topology

**Status:** `DONE` — implementation and owner-executed final local validation complete. M2.12 final verification is tracked below. M2.11 production migration, deployment and public smoke testing remain pending.

- Approved [ADR-0007](../architecture/adr/0007-portfolio-deployment.md) topology: same-origin ticket REST, direct Browser → Render Socket.IO, one API instance, explicitly enabled in-process publisher. Ticket is short-lived, hash-only at rest, atomically consumed once and bound to current actor session/Origin/audience/resource.
- Additive migration `20261105120000_m2_11_realtime_outbox` adds ticket persistence and outbox lease/fencing/quarantine fields/index; no financial data migration or domain-state change.
- Publisher claims committed bounded batches with SKIP LOCKED, recovers expired leases, backs off transient errors, quarantines invalid/exhausted events, and never completes failed emissions. At-least-once processing is distinct from client receipt; Socket.IO enqueue success does not guarantee receipt.
- Server reauthorizes subscriptions before fanout and during idle scans. Minimal hints are tenant/location/table isolated. Kitchen, activation/session staff views and Guest/Staff Bill previews refetch REST; fresh-ticket reconnect recovers missed state, coalesces duplicate hints and preserves drafts/manual refresh.
- Unit/component coverage and real PostgreSQL/Socket.IO integration cases cover leases/concurrency/commit visibility, ticket race/expiry/Origin/CSRF/scopes/revocation, transport errors and financial non-mutation. Local verification does not establish production deployment or public behavior.
- Development evidence: focused API realtime/config tests `27/27` PASS, Web realtime tests `11/11` PASS, and `33` affected existing component tests PASS across targeted runs. Follow-up focused PostgreSQL verification on isolated local `eatease_m2_test` passed the six previously failing cases plus the ahead-of-database-clock regression (`7/7` selected). Publication/retry timestamps preserve database timeline constraints across clock skew; fixture events whitelist scope fields and use database time.
- Final owner validation: `131/131` API unit tests, `72/72` Web component tests and `108/108` PostgreSQL integration tests PASS (`311/311` total). API/Web lint, typecheck and production builds PASS. Prisma migration applied successfully to the local test database; Prisma schema validation and client generation PASS.
- Production release remains pending: owner must apply the reviewed M2.11 migration to the managed database, configure/redeploy the API/Web and execute public smoke tests per the [deployment guide](../development/deployment.md#m211-realtime-and-publisher-setup). Local production-build success is not production deployment evidence.

### M2.12 — Final verification and M2 closure

**Status:** `DONE`; M2 overall `DONE` after final owner validation and acceptance review. Production release verification remains pending separately.

- Map approved acceptance criteria to existing meaningful unit/component/PostgreSQL coverage in the [M2 verification record](../development/m2-verification.md). Preserve the owner-confirmed M2.11 `311/311` baseline; do not count it as verification of new M2.12 changes.
- Add real multi-role permission-union persistence coverage, safe publisher-error logging regression and local E2E database-target guard tests.
- Add four Playwright browser scenarios using real local Web/API/PostgreSQL/Socket.IO: activation/explicit claim/cart, Guest/member/Waiter consolidated ordering, lost-response retry, committed Kitchen Queue, realtime/reconnect recovery, copied-QR/old-code/isolation denial and expired/revoked Guest recovery.
- Fix a genuine client recovery gap: re-bootstrap an expired Guest into browse mode explicitly without reloading or losing its in-memory cart; require valid rejoining and explicit submission. No authentication or authorization checks are bypassed.
- Add Chromium E2E to CI against its ephemeral PostgreSQL service. Explicit StaffSession Prisma injection for TSX and the correct Waiter combobox locator resolve the browser follow-up defects. Final owner browser validation is now `5/5 PASS` in one suite, superseding earlier partial runs. A new M2.12 CI result has not been reported; do not infer it from local validation.
- Final owner evidence: API unit `138/138`, Web component `73/73`, PostgreSQL integration `109/109`, Playwright browser E2E `5/5` (`325/325`) PASS. API/Web lint, typecheck, production builds and Prisma schema validation PASS; local PostgreSQL `9/9` migrations applied/up to date. Browser evidence covers login/restoration, ordering, authorization boundaries, Guest recovery, retry and reconnect. Approved Phase 1 acceptance criteria have been reviewed and checked complete.
- Reproducible commands, historical findings and pending production-only gates remain in the verification record. M3.1 was subsequently authorized and completed; later M3 tasks retain separate authorization gates.

## M3 — Fulfillment, cancellation and serving

**Status:** `IN_PROGRESS` — M3.1, M3.2 and M3.3 are `DONE` after owner validation. Remaining transitions and workflows are not complete.

Dependency: M2.

| Status      | Task                                                     |
| ----------- | -------------------------------------------------------- |
| DONE        | Reuse KITCHEN/BAR/DIRECT queue filters verified in M2.10 |
| IN_PROGRESS | Implement versioned item transitions                     |
| TODO        | Implement guest cancellation request and waiter routing  |
| TODO        | Implement Kitchen PREPARING decision                     |
| TODO        | Implement automatic full-waiver adjustments              |
| TODO        | Implement Manager exceptional full correction            |
| TODO        | Implement waiter serving workflow                        |
| TODO        | Implement realtime/reconnect behavior and audit tests    |

### M3.1 — Atomic start preparation

- **Status:** `DONE`; implementation and owner validation complete. M3 remains `IN_PROGRESS` because later transitions and workflows are still pending.
- **Scope:** only KITCHEN/BAR `NEW → PREPARING`, existing staff session/Origin/CSRF/permission enforcement and transaction-time revalidation; no UI controls, other transitions, cancellation or money changes.
- **Artifacts:** additive nullable preparation timestamp migration; staff REST command, atomic membership audit/outbox/idempotency; `fulfillment.item.updated` allowlist/kitchen routing and focused tests. [Authoritative contract](../architecture/api-contracts.md#post-stafffulfillmentitemsidstart-preparation-m31).
- **Acceptance:** one status/version/time/audit/event/result under retries/races; deny invalid state/station/version/scope/authentication; rollback leaves no partial records; Order/snapshots/BillLines/Bill totals unchanged.
- **Verification:** owner-confirmed local validation: migration `10/10` applied and schema up to date; PostgreSQL integration `49/49` PASS; API unit `154/154` PASS; API lint, typecheck and production build PASS; Prisma validate/generate PASS; `pnpm format:check` and `git diff --check` PASS.
- **Release boundary:** production migration/deployment and public smoke testing remain pending; local validation does not establish production behavior.
- **Next:** continue the remaining item transitions only after separate owner authorization; no automatic continuation is authorized.

### M3.2 — Atomic ready transitions

- **Status:** `DONE`; implementation and owner validation complete. M3 overall remains `IN_PROGRESS` because later transitions and workflows are still pending.
- **Scope:** KITCHEN/BAR `PREPARING → READY` and DIRECT `NEW → READY`; one shared command transaction with M3.1, unchanged staff security/version/idempotency/scope rules, actor audit and existing realtime routing. No UI, serving/cancellation/rejection or financial work.
- **Artifacts:** reviewed additive `ready_at` migration, shared FulfillmentTransitionService/parser, `POST /staff/fulfillment/items/:id/mark-ready`, focused unit and PostgreSQL cases. See [API contract](../architecture/api-contracts.md#post-stafffulfillmentitemsidmark-ready-m32).
- **Acceptance:** allowed station/state matrix, one version/timestamp/audit/event under retries/races, operation-scoped replay/conflicts, authorization and rollback consistency; preparingAt/snapshots/Order/BillLines/Bill totals unchanged.
- **Verification:** owner-confirmed local validation: migrations `11/11` applied and schema up to date; PostgreSQL integration `62/62` PASS; API unit `155/155` PASS; API lint, typecheck and production build PASS; Prisma validate/generate PASS; `pnpm format:check` and `git diff --check` PASS.
- **Release/checkpoint:** production migration/deployment/public smoke remain pending; local validation does not establish production behavior. Do not start the next task before separate owner authorization.

### M3.3 — Interactive fulfillment board

- **Status:** `DONE`; implementation and owner validation complete. M3 overall remains `IN_PROGRESS` because later transitions and workflows are still pending.
- **Scope:** extend the existing authenticated staff board with NEW/PREPARING/READY status filters and existing station filters/pagination. Expose only M3.1/M3.2 actions allowed by station/state and `fulfillment.transition`; preserve `fulfillment.read`, server-derived scope and snapshots.
- **Artifacts:** backward-compatible query status extension (default NEW), existing KitchenQueue/workspace action integration, in-memory item/action/version retry keys, CSRF recovery, double-submit protection, 409 refetch, existing kitchen realtime invalidation/reconnect and manual refresh fallback. No migration or new transition command.
- **Acceptance:** operational state/station queries remain scoped and deterministically paginated; actions send latest server version, retain retry identity on ambiguous failures, and refetch authoritative state; permission/session errors fail closed; no financial changes or raw staff credentials in JavaScript.
- **Verification:** owner-confirmed local validation: PostgreSQL integration `63/63`, API unit `161/161`, Web unit `96/96` and Playwright E2E `5/5` PASS (`325/325` total). API/Web lint, typecheck and production builds, `pnpm format:check` and `git diff --check` PASS. No M3.3 migration was required.
- **E2E note:** the successful suite logged Next dev-server `ECONNRESET` at teardown. Focused investigation confirmed no application defect and required no code changes; the exact request/socket was not identified. This does not invalidate the owner-confirmed passing assertions or establish production behavior.
- **Release/checkpoint:** production migrations/deployment/public smoke remain pending; local validation does not establish production behavior. No serving, rejection, cancellation, waiver or payment workflow is included. Do not begin the next task before separate owner authorization.

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
