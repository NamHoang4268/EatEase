# Incremental roadmap

Status: **APPROVED planning baseline**

Mỗi milestone chỉ bắt đầu khi dependency hoàn tất và có authorization phù hợp. Việc có planning document không đồng nghĩa code đã implemented.

## M0 — Repository and documentation bootstrap

**Goal:** tạo durable workspace và source-of-truth documents.

**Dependencies:** architecture/business baseline đã được phê duyệt; empty EatEase directory.

**Scope/tasks:** local Git, repository tree, README/AGENTS, product/architecture/planning docs, ADRs, link/consistency verification.

**Acceptance:** repository độc lập; không application source/dependencies/config; tài liệu self-contained; links resolve; V1 không đổi.

**Tests/verification:** file/tree inventory, Markdown-link validation, decision consistency scan, `git status`, V1 status.

**Deliverables:** toàn bộ tài liệu trong [documentation index](../README.md).

## M1 — Project foundation

**Goal:** runnable monorepo foundation chưa triển khai business vertical.

**Status:** implementation, verification và milestone gate `DONE`; owner đã approve chuyển sang M2.

**Dependencies:** M0 approved.

**Scope/tasks:** workspace/package manager decision, Next.js/NestJS scaffolds, TypeScript/lint/format/test tooling, PostgreSQL/Prisma foundation, local Docker environment, config validation, CI-quality commands.

**Acceptance:** clean install; web/API health checks; database migration workflow; tests/lint/typecheck chạy lặp lại; secrets không commit.

**Testing:** smoke tests, configuration failures, migration verification, CI-equivalent local commands.

**Deliverables:** `apps/web`, `apps/api`, approved packages, local developer guide và foundation ADR refinements.

## M2 — First business vertical slice

**Goal:** static QR đến kitchen queue với hybrid ordering và consolidated bill preview.

**Status:** M2 và toàn bộ M2.0–M2.12 `DONE` sau final owner validation: API `138/138`, Web `73/73`, PostgreSQL `109/109`, browser E2E `5/5` (`325/325`) PASS; API/Web lint, typecheck, production builds và Prisma schema validation PASS; local PostgreSQL `9/9` migrations applied/up to date. Approved Phase 1 acceptance criteria đã đạt; xem [M2 closure evidence](../development/m2-verification.md). M2.11 production migration/deployment và public smoke testing vẫn pending, không nằm trong claim local verification này.

**Dependencies:** M1 completed/owner-approved; schema/permission/API contract review theo task liên quan.

**Scope/tasks:** restaurant/location/table fixtures, staff auth/RBAC, public menu, activation waiting/approval, guest credential/join code/recovery, explicit QR submit, waiter order, bill preview, kitchen queue, transactions/idempotency/outbox.

**Acceptance:** [Phase 1 acceptance criteria](phase-01.md) đạt; static QR không cấp order; approval không auto-submit; QR/staff orders cùng session/bill; duplicates/concurrency/scope được bảo vệ.

**Testing:** unit, PostgreSQL integration, API authorization, concurrency và end-to-end scenarios.

**Deliverables:** first demonstrable business slice và test evidence.

## M3 — Fulfillment, cancellation and serving

**Status:** `IN_PROGRESS` — M3.1–M3.5 are `DONE` after owner-confirmed local validation. M3.6 remains `TODO` pending separate authorization. Production migrations/deployment/public smoke remain pending separately.

**Goal:** complete item-level operational lifecycle.

M3.2 atomic ready transitions are `DONE`: KITCHEN/BAR PREPARING → READY and DIRECT NEW → READY share M3.1 transaction/security/idempotency infrastructure. See [task tracker](implementation-plan.md#m32--atomic-ready-transitions).

M3.3 interactive fulfillment board is `DONE`: operational status filters, existing transition actions, retry/version recovery and scoped realtime REST refetch extend the staff workspace. No new migration, serving or financial command is added. See [M3.3 tracker and validation evidence](implementation-plan.md#m33--interactive-fulfillment-board). Production migrations/deployment/public smoke remain pending.

**Dependencies:** M2 committed order/queue model.

M3.4 waiter serving is `DONE`: READY → SERVED uses dedicated `serving.mark_served`, the shared transition transaction, servedAt migration, existing board and scoped realtime refetch. SERVED remains terminal. See [M3.4 validation and unresolved intermittent E2E evidence](implementation-plan.md#m34--waiter-serving). Login navigation-loop and expired-Guest failures have unconfirmed root causes; recurrence requires investigation and a verified fix rather than repeated reruns/cache clearing. Production migration/deployment/public smoke remain pending.

M3.5 is `DONE`: Guest requests remain pending until the approved Waiter/Kitchen decision path; direct Kitchen/Bar rejection is limited to NEW; accepted cancellation preserves original financial history and creates one auditable full waiver. Owner local validation passed `453/453` tests with all `13/13` migrations applied, Prisma validation/generation, full lint/typecheck and API/Web production builds passing. See the [M3.5 tracker and validation evidence](implementation-plan.md#m35--guest-cancellation-and-kitchen-decision). Production migration/deployment/public smoke remain pending.

**Scope/tasks:** KITCHEN/BAR/DIRECT filters, PREPARING/READY/SERVED transitions, service/cancellation requests, Kitchen decision, automatic full waiver, Manager exceptions, realtime updates.

**Acceptance:** state transitions enforce actor/state/version; historical items/lines immutable; cancellation/waiver auditable; realtime failure không mất state.

**Testing:** transition matrix, concurrent updates, cancellation outcomes, adjustment calculations, realtime retry/reconnect.

**Deliverables:** unified fulfillment board, waiter serving flow và cancellation audit trail.

## M4 — Checkout, cash settlement and table lifecycle

**Goal:** close core dine-in business loop.

**Dependencies:** M2 bill; M3 item completion/cancellation policy.

**Scope/tasks:** checkout lock/resume, cashier bill, idempotent cash payment, settlement, session close, cleaning, mark-ready, receipts/basic revenue record.

**Acceptance:** double settlement impossible; payment không auto-release table; close/clean/available transitions đúng permissions; financial operations atomic.

**Testing:** duplicate cash confirmation, unknown/conflicting state, close before settlement denial, table lifecycle E2E, audit verification.

**Deliverables:** complete cash-based dine-in flow.

## M5 — Production readiness and AWS

**Goal:** deployable, observable và operationally supportable system.

**Dependencies:** M4 stable workflow và measured non-functional requirements.

**Scope/tasks:** production containers, CI/CD, Terraform/AWS ECS-RDS-S3 direction, secrets, backups, monitoring/logging/alerts, security review, load/recovery testing, runbooks.

**Acceptance:** repeatable environment promotion; rollback/recovery documented; monitoring/security gates pass; no manual hidden infrastructure.

**Testing:** pipeline, infrastructure validation, backup restore, failure drills, performance baseline, security checks.

**Deliverables:** deployment artifacts, operational dashboards/runbooks và release evidence.
