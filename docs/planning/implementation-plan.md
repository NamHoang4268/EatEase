# Implementation plan and task tracker

Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

Planning completion và implementation completion là hai việc khác nhau. M1–M5 hiện chưa được implement.

## M0 — Repository and documentation bootstrap

| Status | Task | Verification |
|---|---|---|
| DONE | Xác nhận repository boundary và V1 separation | Absolute paths + clean V1 status |
| DONE | Initialize local Git, không remote/commit | `.git` exists; no remote/commit |
| DONE | Tạo root/docs/placeholder tree | Tree inventory |
| DONE | Viết README, AGENTS và documentation index | Content review |
| DONE | Ghi product requirements/business rules | Decision consistency review |
| DONE | Ghi architecture, security, API, permissions và ADRs | Cross-link review |
| DONE | Ghi roadmap, Phase 1 và decision log | Status/acceptance review |
| DONE | Verify all relative Markdown links and final Git/V1 status | 21 Markdown files; 0 missing links; V1 clean |
| DONE | Final focused documentation audit trước initial commit | Business/architecture/planning consistency reviewed; approval gates and decision classification aligned |

## M1 — Project foundation

Dependency: M0 review/approval.

| Status | Task |
|---|---|
| TODO | Chọn Node.js/package-manager/workspace versions và ghi ADR/update |
| TODO | Scaffold Next.js App Router tại `apps/web` |
| TODO | Scaffold NestJS/Express tại `apps/api` |
| TODO | Thiết lập shared contracts/config/testing packages có boundary |
| TODO | Thiết lập TypeScript, formatter, lint, unit-test và workspace scripts |
| TODO | Thiết lập PostgreSQL/Prisma và reviewed migration workflow |
| TODO | Tạo local Docker development environment |
| TODO | Thiết lập validated configuration/secrets handling |
| TODO | Tạo health/readiness checks và foundation smoke tests |
| TODO | Viết developer setup và verification commands |

M1 acceptance/testing/deliverables: xem [roadmap](roadmap.md#m1--project-foundation).

## M2 — First business vertical slice

Dependency: M1 complete; [Phase 1 plan](phase-01.md) approved.

| Status | Task |
|---|---|
| TODO | Implement restaurant/location/table/menu minimum model + fixtures |
| TODO | Implement staff auth, memberships, multi-role permissions |
| TODO | Implement static QR public table/menu context |
| TODO | Implement browse-only guest session + CSRF |
| TODO | Implement activation request/waiting UX and concurrent guard |
| TODO | Implement waiter approval transaction |
| TODO | Implement join-code issue/rotate/rate-limit/recovery |
| TODO | Implement explicit guest SubmitOrder |
| TODO | Implement waiter-assisted SubmitOrder using same use case |
| TODO | Implement consolidated bill preview |
| TODO | Implement unified kitchen queue read |
| TODO | Implement idempotency/outbox publisher and authorized realtime rooms |
| TODO | Complete unit/integration/authorization/concurrency/E2E suite |

## M3 — Fulfillment, cancellation and serving

Dependency: M2.

| Status | Task |
|---|---|
| TODO | Implement KITCHEN/BAR/DIRECT queue filters |
| TODO | Implement versioned item transitions |
| TODO | Implement guest cancellation request and waiter routing |
| TODO | Implement Kitchen PREPARING decision |
| TODO | Implement automatic full-waiver adjustments |
| TODO | Implement Manager exceptional full correction |
| TODO | Implement waiter serving workflow |
| TODO | Implement realtime/reconnect behavior and audit tests |

## M4 — Checkout and table lifecycle

Dependency: M3.

| Status | Task |
|---|---|
| TODO | Implement checkout lock/resume |
| TODO | Implement cashier bill view |
| TODO | Implement idempotent cash payment + settlement transaction |
| TODO | Implement session close |
| TODO | Implement cleaning and mark-ready |
| TODO | Implement receipt/basic revenue records |
| TODO | Complete financial concurrency and lifecycle E2E tests |

## M5 — Production readiness and AWS

Dependency: stable M4.

| Status | Task |
|---|---|
| TODO | Production container strategy |
| TODO | CI/CD quality, migration and deployment gates |
| TODO | Terraform/AWS architecture and environments |
| TODO | Secrets, backups and restore validation |
| TODO | Logging, metrics, traces and alerts |
| TODO | Security/load/recovery validation |
| TODO | Runbooks, rollback and release evidence |

## Update rules

- Chuyển task sang `IN_PROGRESS` khi bắt đầu thực tế.
- `BLOCKED` phải kèm blocker trong task/issue hoặc adjacent note.
- `DONE` yêu cầu verification evidence; documentation-only không hoàn tất implementation task.
- Scope/decision change phải cập nhật [decision log](decision-log.md) và ADR nếu cần.
