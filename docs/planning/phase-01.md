# Phase 1 — First business vertical slice

Status: **APPROVED planning target**, implementation `DONE` (`M2.0–M2.12 DONE`; final owner validation and M2 acceptance review complete).

M2 final owner validation: API `138/138`, Web `73/73`, PostgreSQL `109/109`, browser E2E `5/5` (`325/325`) PASS; API/Web lint, typecheck, production builds and Prisma schema validation PASS; local PostgreSQL `9/9` migrations applied/up to date. All approved M2 acceptance criteria below are satisfied by the [coverage and final evidence](../development/m2-verification.md). M2.11 production migration/deployment and public smoke testing remain pending; local milestone closure does not claim production verification. M3 is next and requires separate implementation authorization.

Trong roadmap repository, business Phase 1 được thực hiện tại Milestone M2 sau foundation M1.

## Objective

```text
Static QR
→ Browse/menu + draft cart
→ Activation request
→ Waiter approval
→ Guest session/join code
→ Explicit QR order submission
→ Waiter-assisted order submission
→ Kitchen queue
→ Consolidated bill preview
```

Serving, cancellation execution, checkout/payment và table cleaning thuộc milestones sau; chỉ model/contract cần thiết được chuẩn bị incrementally.

## Dependencies

- M1 monorepo/runtime/database/test foundation.
- Approved [business rules](../product/business-rules.md).
- Reviewed [data model](../architecture/data-model.md), [security](../architecture/security.md) và [API contracts](../architecture/api-contracts.md).

## In scope

- One restaurant/one active location fixtures.
- Table static public identifier/QR representation.
- Public server-priced menu.
- Staff login and Waiter/Kitchen permissions.
- Browse-only guest cookie + CSRF.
- Single pending activation waiting experience.
- Atomic waiter approval.
- Per-device order-enabled guest session.
- Temporary join code and credential-expiry recovery.
- QR and waiter `SubmitOrder` through same application use case.
- Immutable snapshots, BillLines và consolidated preview.
- Kitchen queue read.
- Idempotency, outbox và minimal realtime notification.

## Out of scope

- Item preparation/serving UI transitions beyond queue visibility.
- Cancellation workflow execution.
- Checkout, payment, settlement, session close và table ready.
- Deferred product features listed in requirements.

## Acceptance criteria

### Activation and guest access

- [x] Static QR never grants ordering permission.
- [x] Guest can browse/build local draft before activation.
- [x] Another guest sees safe waiting state when activation is pending.
- [x] Approval creates no Order and never submits draft.
- [x] Exactly one active session is created under concurrent approval.
- [x] Table becomes occupied atomically with session activation.
- [x] Approval không tự upgrade guest; requester explicit claim rotates guest + CSRF credentials khi nâng access.
- [x] Additional device needs valid join code and gets independent credential.
- [x] Expired/revoked code is rejected and attempts are rate-limited.
- [x] Expired/revoked Guest keeps the local draft, explicitly recovers browse access and rejoins without reload or automatic submission; owner-confirmed M2.12 browser verification PASS.

### Ordering and billing preview

- [x] QR and waiter submit separate Orders into the same TableSession.
- [x] Both orders contribute immutable lines to one Bill.
- [x] Client-supplied/fake price cannot affect persisted price.
- [x] Menu price change after submit does not alter snapshots.
- [x] Invalid item makes command fail atomically; no partial Order.
- [x] Same idempotency key/payload returns one logical result.
- [x] Same key with different payload returns conflict.
- [x] Two distinct concurrent valid submissions are both preserved.
- [x] Non-active/checkout-locked session rejects new orders.
- [x] Kitchen sees item only after committed order.

### Authorization and reliability

- [x] Guest cannot read/write another TableSession.
- [x] Staff cannot cross location scope.
- [x] Multi-role staff receives intended permission union.
- [x] Disabled/revoked staff/guest session is denied.
- [x] HTTP and Socket.IO room access use server-side authorization.
- [x] Socket outage does not roll back or lose committed order.
- [x] Outbox retry does not duplicate business records.
- [x] Transaction failure leaves no orphan Order/BillLine/Table state.
- [x] Logs contain no raw credential/join code.

## Test scenarios

Acceptance coverage and final owner evidence are mapped in the [M2 verification record](../development/m2-verification.md). PostgreSQL tests cover permission union, authorized fanout, retry/rollback and financial consistency; unit/source review covers safe application logging; browser E2E verifies complete workflows and expired/revoked Guest recovery without page reload or automatic submission. Production infrastructure/logs and public transport behavior are not inferred from local results.

### Unit

- Money/snapshot calculation, permissions union, state guards, request hashing, expiry and join-code validation.

### PostgreSQL integration

- Partial unique constraints, approval race, concurrent orders, atomic Order/BillLine/outbox, optimistic conflict và scope FKs.

### API authorization

- Allowed, unauthenticated, missing permission, wrong location, wrong relationship, revoked/expired và invalid state.

### End-to-end

1. Scan → cart → request → approve → cart remains draft → explicit submit → queue.
2. Second device joins → second order → consolidated preview.
3. Waiter adds order to same session.
4. Double tap/network retry produces one Order.
5. Copied static QR and old join code cannot order.

## Deliverables

- Working demonstrable vertical slice.
- Automated test evidence mapped to acceptance criteria.
- Updated API/data-model docs nếu implementation discovery yêu cầu approved refinement.
- Task statuses/evidence trong [implementation plan](implementation-plan.md).
