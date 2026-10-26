# Phase 1 — First business vertical slice

Status: **APPROVED planning target**, implementation `TODO`.

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

- [ ] Static QR never grants ordering permission.
- [ ] Guest can browse/build local draft before activation.
- [ ] Another guest sees safe waiting state when activation is pending.
- [ ] Approval creates no Order and never submits draft.
- [ ] Exactly one active session is created under concurrent approval.
- [ ] Table becomes occupied atomically with session activation.
- [ ] Guest credential rotates when upgraded.
- [ ] Additional device needs valid join code and gets independent credential.
- [ ] Expired/revoked code is rejected and attempts are rate-limited.
- [ ] Expired guest keeps local draft, rejoins, revalidates and explicitly submits.

### Ordering and billing preview

- [ ] QR and waiter submit separate Orders into the same TableSession.
- [ ] Both orders contribute immutable lines to one Bill.
- [ ] Client-supplied/fake price cannot affect persisted price.
- [ ] Menu price change after submit does not alter snapshots.
- [ ] Invalid item makes command fail atomically; no partial Order.
- [ ] Same idempotency key/payload returns one logical result.
- [ ] Same key with different payload returns conflict.
- [ ] Two distinct concurrent valid submissions are both preserved.
- [ ] Non-active/checkout-locked session rejects new orders.
- [ ] Kitchen sees item only after committed order.

### Authorization and reliability

- [ ] Guest cannot read/write another TableSession.
- [ ] Staff cannot cross location scope.
- [ ] Multi-role staff receives intended permission union.
- [ ] Disabled/revoked staff/guest session is denied.
- [ ] HTTP and Socket.IO room access use server-side authorization.
- [ ] Socket outage does not roll back or lose committed order.
- [ ] Outbox retry does not duplicate business records.
- [ ] Transaction failure leaves no orphan Order/BillLine/Table state.
- [ ] Logs contain no raw credential/join code.

## Test scenarios

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
