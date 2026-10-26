# Architecture overview

Status: **APPROVED baseline**

## System context

EatEase là web-based dine-in ordering and restaurant operations system. Khách sử dụng mobile browser; staff sử dụng role-aware operational dashboards. Mọi client gọi một backend authoritative duy nhất.

```text
Next.js web
  ├─ Guest QR/menu/order experience
  └─ Staff operational dashboards
          │ REST commands/queries
          │ Socket.IO notifications
          ▼
NestJS Modular Monolith
  ├─ Identity & Access
  ├─ Restaurant & Location
  ├─ Table & Activation
  ├─ Menu
  ├─ Ordering
  ├─ Fulfillment
  ├─ Billing
  ├─ Payment & Settlement
  └─ Realtime / Audit / Reliability
          │
          ▼
PostgreSQL + Prisma
```

## Technical baseline

- TypeScript cho web, API và shared contracts.
- Next.js App Router frontend.
- NestJS với Express adapter backend.
- PostgreSQL relational persistence.
- Prisma ORM; custom SQL migrations được phép cho native constraints/features.
- REST authoritative; Socket.IO không thay thế database reads/writes.
- Transactional outbox cho reliable publication.
- Local Docker environment được lập kế hoạch ở M1, chưa tồn tại trong M0.

Các quyết định kỹ thuật được giải thích trong [ADR index](adr/README.md).

## Module boundaries

### Identity & Access

Staff identity, membership, multiple roles, permissions, staff sessions và guest sessions. Không sở hữu table/order business state.

### Restaurant & Location

Restaurant, location, physical tables và tenant/location ownership constraints.

### Table & Activation

Activation requests, TableSession, join codes, session closure và physical table lifecycle.

### Menu

Categories, items, displayed price, availability và fulfillment station assignment.

### Ordering

Explicit QR/staff submission, Order, immutable OrderItem snapshots và cancellation request coordination.

### Fulfillment

Kitchen/Bar/Direct queues và item transitions. Không tự quyết định arbitrary financial adjustment.

### Billing

Bill, immutable BillLines, policy/manager adjustments và balance calculation.

### Payment & Settlement

Cash payment first, settlement invariants và future provider boundary.

### Realtime, Audit & Reliability

Outbox publication, audit records, idempotency và observability helpers. Đây là supporting capability, không chứa business policy riêng.

## Dependency rules

- Controllers/gateways chỉ translate transport ↔ application commands/queries.
- Business transitions nằm trong application/domain services, không nằm rải rác ở UI/controllers.
- Module không import Prisma repository nội bộ của module khác.
- Cross-module write workflow được điều phối qua explicit application service/port trong cùng transaction.
- Shared package chỉ chứa public DTO/schema và tooling; không tạo một “common” dumping ground.
- External side effects không chạy bên trong database transaction; dùng outbox.

## Deployment direction

MVP ưu tiên một web deployable, một API deployable và một PostgreSQL database. Outbox publisher có thể chạy cùng API process ban đầu nhưng phải có ownership/locking để scale an toàn. AWS/ECS/RDS/S3/Terraform chỉ được chi tiết ở M5.

## Source of truth

- Product policy: [business rules](../product/business-rules.md)
- Relational design: [data model](data-model.md)
- Lifecycles: [state machines](state-machines.md)
- Authorization: [permissions](permissions.md)
- Security controls: [security](security.md)
- First slice transport: [API contracts](api-contracts.md)
